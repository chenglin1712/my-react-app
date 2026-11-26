import { db, auth } from "../../../firebase";
import { collection, addDoc, serverTimestamp, query, where, doc, getDoc, getDocs, orderBy, runTransaction, limit, startAfter, documentId } from "firebase/firestore";
import { TRIBE_FULL_NAME_BY_SLUG as TRIBE_NAME } from "../constants/tribes";
import { normalizeCalendarEvent } from "../../utils/calendarEvents";

// 測驗題目（quizs）由伺服器在出題時建立並回傳 quizId（backend/crawler/quiz_store.py），前端不再寫入：
// firestore.rules 對 quizs 不開放 client 建立（S-06）。
//更新答題情形至資料庫
export const uploadSituationDB = async (quizId, correctAns, userAns, stars) => {
    const results = evaluateAnswers(correctAns, userAns);

    // 登入狀態在作答途中失效（登出、token 過期）時 uid 會是 undefined，Firestore 會用
    // 「Unsupported field value: undefined」拒絕整份文件，錯誤訊息完全看不出原因。紀錄必須綁定使用者
    // （firestore.rules 與之後的本人查詢都靠 userId），沒有 uid 就不能寫，直接明確失敗。
    // 失敗的回傳方式跟下面 catch 一致（undefined），呼叫端已有「儲存失敗」的處理。
    const userId = auth.currentUser?.uid;
    if (!userId) {
        console.error("上傳失敗：目前沒有登入的使用者，作答紀錄無法儲存");
        return undefined;
    }

    const situationSet = {
        userId,
        quizId: quizId,
        answeredAt: serverTimestamp(),
        stars: stars ?? [],
        // quiz_panel.jsx 的 handleUploadSituation 在使用者一題都沒作答就繳交時
        // 會傳 null（見下方 evaluateAnswers 的說明）。存成 [] 而不是 null，
        // 讓 review.jsx／quiz_panel_submit.jsx 對 answers[idx] 的直接索引不會
        // 因為 null[idx] 而噴例外（跟 stars ?? [] 同一套防呆）。
        answers: userAns ?? [],
        // 正確答案改存在這裡（本人才能讀的文件）而不是 quizs（見 uploadQuizDB
        // 的說明），review.jsx／quiz_panel_submit.jsx 顯示「正確答案」時改讀
        // 這裡而不是 quizs 文件的 data[i].answer。
        correctAnswers: correctAns ?? null,
        results: results
    }

    try {
        const docRef = await addDoc(collection(db, "situations"), situationSet);
        return docRef.id
    } catch (e) {
        console.error("上傳失敗", e);
    }
};

//比對回答是否正確
const evaluateAnswers = (correctAns, userAns) => {
    // 使用者一題都沒作答就繳交時，quiz_panel.jsx 會傳 correctAns=null（見
    // handleUploadSituation），原本 correctAns.map(...) 會直接對 null 呼叫
    // .map() 丟出未捕捉的 TypeError，讓整個繳交流程卡住、無法導向結果頁。
    if (!correctAns) return [];
    return correctAns.map((correctAnswer, index) => {
        const userAnswer = userAns?.[index];
        let questionSituation;
        if (userAnswer === null || userAnswer === undefined) {
            questionSituation = null;
        } else {
            questionSituation = userAnswer === correctAnswer;
        }
        return {
            isCorrect: questionSituation
        };
    });
};

//計算分數
export const countScore = (results) => {
    if (!results || results.length === 0) return 0;
    const totalQuestions = results.length;
    const correctCount = results.filter(item => item.isCorrect).length;

    const score = (correctCount / totalQuestions) * 100;

    return Math.round(score);
};
//取得答題測驗ID
// id 接受兩種形狀：字串（situation 文件 id 本身），或帶 situationID 欄位的
// 物件（呼叫端有時把整個 situation 相關的物件直接傳進來，例如 quiz_panel_submit
// 拿到的路由參數）。呼叫端目前傳的都是單一字串，保留物件分支是為了相容既有
// 呼叫慣例，不是這個函式本身需要的邏輯。
export const getQuizSubmitById = async (id) => {
    let situationDocId = null;
    if (typeof id === "string") {
        situationDocId = id;
    } else if (id && typeof id === "object") {
        situationDocId = id.situationID;
    }
    try {
        const docRef = doc(db, "situations", situationDocId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const submitData = docSnap.data();
            const { quizId } = submitData;

            if (quizId) {
                const quizRef = doc(db, "quizs", String(quizId));
                const quizSnap = await getDoc(quizRef);

                if (quizSnap.exists()) {
                    const quizData = quizSnap.data();
                    return {
                        ...submitData,
                        quiz: quizData
                    };
                } else {
                    // quiz not found
                    return {
                        ...submitData,
                        quiz: null
                    };
                }
            }

            return submitData;
        } else {
            // situation not found
            return null;
        }
    } catch (error) {
        console.error("取得提交的測驗失敗:", error);
        return null;
    }
};
// 稽核 FE1-11／FE4-10：原本一次讀出全部作答紀錄（沒有 limit），再對每一筆各做一次 getDoc(quizs)，
// 作答一百次就是一百多次讀取，同一份題目被作答多次也會重複讀。改成：
// 1. 伺服器端分頁：每次只讀 pageSize 筆（多讀 1 筆只用來判斷還有沒有下一頁，不回傳），用 startAfter 接續；
// 2. 只對這一頁「去重後」的 quizId 查 quizs，並用 documentId() in [...] 批次讀（每批 10 筆，
//    是各版 Firestore 都接受的 in 上限，不必依賴新版放寬的 30 筆）。
// 排序維持 answeredAt 由新到舊（orderBy 本來就會排除沒有 answeredAt 的文件，行為不變）。
export const SITUATION_PAGE_SIZE = 20;
const QUIZ_IN_BATCH_SIZE = 10;

function toQuizType(quizData) {
    if (!quizData) return "未知類型";
    // 舊資料沒有 tribe 欄位，一律視為泰雅語（該功能上線時唯一支援的語言）
    const tribe = quizData.tribe || "tayal";
    const title = quizData.title || "未知";
    return tribe === "tayal" ? title : `${TRIBE_NAME[tribe] || tribe}-${title}`;
}

// 批次讀題目文件，回傳 quizId → 題目資料。某一批讀取失敗只讓那一批顯示「未知類型」，不拖垮整頁。
async function fetchQuizzesByIds(quizIds) {
    const quizById = new Map();
    const batches = [];
    for (let i = 0; i < quizIds.length; i += QUIZ_IN_BATCH_SIZE) {
        batches.push(quizIds.slice(i, i + QUIZ_IN_BATCH_SIZE));
    }
    await Promise.all(batches.map(async (ids) => {
        try {
            const snapshot = await getDocs(query(collection(db, "quizs"), where(documentId(), "in", ids)));
            snapshot.forEach((quizDoc) => { quizById.set(quizDoc.id, quizDoc.data()); });
        } catch (err) {
            console.error(`取得 quiz（${ids.join(", ")}）失敗:`, err);
        }
    }));
    return quizById;
}

//取得最近的答題情形（分頁）
// 回傳 { situations, cursor, hasMore }：cursor 傳回下一次呼叫即可接著讀更早的紀錄。
// 讀取失敗會往外拋（不再回傳空陣列），讓畫面能分辨「沒有紀錄」與「讀取失敗」。
export const getCurrentSituation = async ({ pageSize = SITUATION_PAGE_SIZE, cursor = null } = {}) => {
    const user = auth.currentUser;

    if (!user) {
        return { situations: [], cursor: null, hasMore: false };
    }

    const constraints = [
        where("userId", "==", user.uid),
        orderBy("answeredAt", "desc"),
    ];
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(pageSize + 1));

    const querySnapshot = await getDocs(query(collection(db, "situations"), ...constraints));
    const pageDocs = querySnapshot.docs.slice(0, pageSize);
    const hasMore = querySnapshot.docs.length > pageSize;
    const situations = pageDocs.map((situationDoc) => ({ id: situationDoc.id, ...situationDoc.data() }));

    const quizIds = [...new Set(situations.filter((s) => s.quizId).map((s) => String(s.quizId)))];
    const quizById = quizIds.length > 0 ? await fetchQuizzesByIds(quizIds) : new Map();

    return {
        situations: situations.map((s) => ({
            ...s,
            quizType: s.quizId ? toQuizType(quizById.get(String(s.quizId))) : "未知類型",
        })),
        cursor: pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : cursor,
        hasMore,
    };
};

export const getQuizById = async (id) => {
    try {
        const quizRef = doc(db, "quizs", id);
        const quizSnap = await getDoc(quizRef);

        if (quizSnap.exists()) {
            const quizData = quizSnap.data();
            return quizData;
        } else {
            // quiz not found
            return null;
        }
    } catch (error) {
        console.error("從id取得測驗失敗:", error);
        return null;
    }
};
//取得使用者答題情形
export const getUserSituation = async () => {
    const user = auth.currentUser;

    if (!user) {
        // 使用者未登入，回傳 null
        return null;
    }

    const userQuery = query(
        collection(db, "userSituation"),
        where("userId", "==", user.uid)
    );
    const userPromise = getDocs(userQuery);

    const globalDocRef = doc(db, "userSituation", "globalAverages");
    const globalPromise = getDoc(globalDocRef);

    try {
        const [userQuerySnapshot, globalDocSnap] = await Promise.all([
            userPromise,
            globalPromise,
        ]);

        if (userQuerySnapshot.empty) {
            // 無答題記錄
            return null;
        }

        let userData = {};
        let globalData = {};

        if (!userQuerySnapshot.empty) {
            const userDoc = userQuerySnapshot.docs[0];
            const data = userDoc.data();
            userData = {
                level: data.level || "N/A",
                speed: data.speed || "N/A",
                advice: data.advice || "",
                radarData: data.radarData || [],
                // monthlyAccuracy 下面是用 .map() 處理的（跟 radarData/accuracyByType
                // 一樣），缺欄位時要退回陣列而不是物件，不然 .map() 會直接拋錯。
                monthlyAccuracy: data.monthlyAccuracy || [],
                questionTypeDistribution: data.questionTypeDistribution || {},
                accuracyByType: data.accuracyByType || [],
            };
        }

        if (globalDocSnap.exists()) {
            const data = globalDocSnap.data();
            globalData = {
                allUsersAccuracyByType: data.allUsersAccuracyByType || [],
                allUsersMonthlyAccuracy: data.allUsersMonthlyAccuracy || []
            };
        }

        let mergedAccuracyByType = [];
        if (userData.accuracyByType && globalData.allUsersAccuracyByType) {
            const averagesMap = new Map(
                globalData.allUsersAccuracyByType.map(item => [item.type, item.averageAccuracy])
            );

            mergedAccuracyByType = userData.accuracyByType.map(item => ({
                ...item,
                // 用 ?? 而不是 ||：全站平均正確率剛好是 0（合法值）時，
                // || 會把它跟「查無資料」的 undefined 一樣當成 null。
                averageAccuracy: averagesMap.get(item.type) ?? null,
            }));
        }

        let mergedAccuracyByMonth = [];
        if (userData.monthlyAccuracy && globalData.allUsersMonthlyAccuracy) {
            const averagesMap = new Map(
                globalData.allUsersMonthlyAccuracy.map(item => [item.date, item.averageAccuracy])
            );

            mergedAccuracyByMonth = userData.monthlyAccuracy.map(item => ({
                ...item,
                averageAccuracy: averagesMap.get(item.date) ?? null,
            }));
        }

        // 前面已經在 userQuerySnapshot.empty 時提前 return null，走到這裡
        // userData 一定已經被賦值過（至少有 level/speed/advice 等欄位），
        // 所以不會有「allData 是空物件」的情況，不需要再檢查一次。
        return { ...userData, accuracyByType: mergedAccuracyByType, monthlyAccuracy: mergedAccuracyByMonth };

    } catch (error) {
        console.error("取得資料時發生錯誤: ", error);
        throw error;
    }
};
//抓取行事曆資料
export const getCalendar = async () => {
    const user = auth.currentUser;

    if (!user) {
        // 使用者未登入，回傳 null
        return null;
    }

    // 稽核 FE6-11／FE1-23：原本讀取失敗只記 log 後回傳 []，畫面每天都顯示「尚無紀錄」，
    // 使用者會誤以為行程被刪掉而重新輸入。現在失敗直接往外拋，由畫面顯示錯誤與重試。
    const docRef = doc(db, "calendar", user.uid);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) return [];
    const events = docSnap.data().events;
    return Array.isArray(events) ? events : [];
};

// 新增一筆或多筆行事曆事件。calendar/{uid} 是單一文件、events 是它裡面的
// 一個陣列欄位（不是各自獨立的 Firestore 文件），所以「新增」實際上是讀出
// 整個陣列、在記憶體加上新項目、整包寫回。這個「讀、改、寫」包在
// runTransaction 裡：多分頁／多裝置同時編輯時，Firestore 偵測到文件已被改過會
// 自動重讀並重跑，不會再有後寫者蓋掉先寫者、悄悄遺失事件的問題（回呼內只做
// 讀、算、寫，因為可能被重跑多次）。
//
// 一次寫入多筆（addCalendarEvents）而不是讓呼叫端對每筆各自呼叫
// addCalendarEvent 再用 Promise.all 平行送出：每次呼叫都是獨立的「整包讀出、
// 整包寫回」，平行呼叫會全部讀到同一份舊資料，最後只有最晚寫回的那次生效，
// 其餘會被覆蓋、悄悄遺失（bot_study_plan.jsx 的「全部加入」需要一次寫入好幾筆，
// 就是為了避免這個問題才加這個函式）。
//
// event 補上 client-generated 的 id（陣列本身沒有 Firestore 文件 id 可用），
// 讓刪除／React key 都能用穩定的 id，不必依賴陣列 index。
// firestore.rules 限制 calendar/{uid}.events 最多 500 筆（稽核 RUL-5）。超過時整筆 transaction 會被拒絕，
// 畫面只能顯示泛用的「請稍後再試」而且重試永遠不會成功（稽核 FE6-12），所以寫入前先在 transaction 內檢查，
// 丟出可辨識的錯誤讓畫面說明原因。
export const CALENDAR_EVENT_LIMIT = 500;

export class CalendarFullError extends Error {
    constructor() {
        super("行事曆已滿，請先刪除舊行程");
        this.name = "CalendarFullError";
        this.code = "calendar/full";
    }
}

// 稽核 FE4-09：判斷「同一個行程」用的鍵（名稱＋開始＋結束）。時間先解析成毫秒再比，
// 同一時刻寫成 +08:00 或 Z 也視為相同；解析不了就用原字串。
function eventTime(value) {
    const ms = typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isNaN(ms) ? String(value ?? "") : String(ms);
}
export function calendarEventDedupeKey(event) {
    return `${String(event?.summary ?? "").trim()}|${eventTime(event?.start)}|${eventTime(event?.end)}`;
}

// 共用的寫入核心：skipDuplicates 為 true 時，行事曆裡已有「名稱＋開始＋結束」相同的行程就不再寫入，
// 回傳既有那一筆（保留它的 id，讀書計畫的追蹤功能仍找得到對應的行事曆事件）。
async function writeCalendarEvents(events, { skipDuplicates }) {
    const user = auth.currentUser;
    if (!user) throw new Error("請先登入才能新增行程");

    const docRef = doc(db, "calendar", user.uid);
    // 每一筆都補齊 allDay（是否全天）與 type（"quiz" | "general"）：呼叫端（行事曆頁、學習計畫）
    // 沒明確給的，用 utils/calendarEvents.js 的判讀補上，之後讀取不必再靠猜。
    const candidates = events.map((event) => ({ ...normalizeCalendarEvent(event), id: crypto.randomUUID() }));

    let result = null;
    await runTransaction(db, async (tx) => {
        // 回呼可能被重跑，結果每次都重算，不沿用上一輪的狀態
        const docSnap = await tx.get(docRef);
        const existingEvents = docSnap.exists() ? (docSnap.data().events || []) : [];
        const byKey = new Map();
        if (skipDuplicates) {
            existingEvents.forEach((e) => { if (!byKey.has(calendarEventDedupeKey(e))) byKey.set(calendarEventDedupeKey(e), e); });
        }
        const added = [];
        const saved = candidates.map((event) => {
            if (skipDuplicates) {
                const key = calendarEventDedupeKey(event);
                if (byKey.has(key)) return byKey.get(key);
                byKey.set(key, event);
            }
            added.push(event);
            return event;
        });
        result = { saved, skipped: candidates.length - added.length };
        if (added.length === 0) return;

        const updatedEvents = [...existingEvents, ...added];
        if (updatedEvents.length > CALENDAR_EVENT_LIMIT) throw new CalendarFullError();

        if (docSnap.exists()) {
            tx.update(docRef, { events: updatedEvents });
        } else {
            tx.set(docRef, { events: updatedEvents });
        }
    });
    return result;
}

export const addCalendarEvents = async (events) => {
    const { saved } = await writeCalendarEvents(events, { skipDuplicates: false });
    return saved;
};

export const addCalendarEvent = async (event) => {
    const [savedEvent] = await addCalendarEvents([event]);
    return savedEvent;
};

// 稽核 FE4-09：讀書計畫卡片的「已加入」狀態只在記憶體，還原對話或重新產生後可再按「全部加入」。
// 讀書計畫改走這個函式：已存在的相同行程略過不寫，回傳 { saved（與輸入同順序）, skipped（略過筆數）}。
// 行事曆頁手動新增不去重（使用者可能刻意在同一時段記兩筆同名行程）。
export const addCalendarEventsSkippingDuplicates = (events) => writeCalendarEvents(events, { skipDuplicates: true });

// 比對沒有 id 的舊行程用的欄位（91905e4 以前寫入的行程只有這幾個欄位）
const LEGACY_EVENT_FIELDS = ["summary", "description", "start", "end"];
function isSameLegacyEvent(a, b) {
    return LEGACY_EVENT_FIELDS.every((field) => (a?.[field] ?? null) === (b?.[field] ?? null));
}

// 刪除一筆行事曆事件，同樣在 transaction 內讀出、過濾、寫回。
// 參數可以是 id 字串，或整個事件物件（有 id 依 id 刪；沒有 id 的舊行程依內容比對）。
//
// 稽核 FE6-04：原本一律 filter(e => e.id !== eventId)；舊行程沒有 id 時 eventId 是 undefined，
// 會把整份行事曆（跨所有日期）所有沒有 id 的行程一次刪光。現在：
// - 有 id：只刪 id 相符的那筆；
// - 沒有 id：只刪「第一筆」沒有 id 且 summary／description／start／end 都相同的行程
//   （內容完全相同的兩筆本來就分不出差別，刪掉其中一筆即可）；
// - 兩者都沒有（undefined、空字串）：直接丟錯，絕不寫回。
export const deleteCalendarEvent = async (eventOrId) => {
    const user = auth.currentUser;
    if (!user) throw new Error("請先登入才能刪除行程");

    const target = typeof eventOrId === "string" ? { id: eventOrId } : eventOrId;
    const targetId = typeof target?.id === "string" && target.id ? target.id : null;
    if (!targetId && !(target && typeof target === "object" && target.start !== undefined)) {
        throw new Error("缺少要刪除的行程識別資料");
    }

    const docRef = doc(db, "calendar", user.uid);
    await runTransaction(db, async (tx) => {
        const docSnap = await tx.get(docRef);
        if (!docSnap.exists()) return;

        const existingEvents = docSnap.data().events || [];
        const index = targetId
            ? existingEvents.findIndex((e) => e?.id === targetId)
            : existingEvents.findIndex((e) => !e?.id && isSameLegacyEvent(e, target));
        // 找不到（例如另一個分頁已經刪掉）就不寫回，維持原本的安全 no-op
        if (index === -1) return;
        tx.update(docRef, { events: existingEvents.filter((_, i) => i !== index) });
    });
};