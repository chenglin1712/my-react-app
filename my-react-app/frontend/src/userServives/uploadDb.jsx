import { db, auth } from "../../../firebase";
import { collection, addDoc, serverTimestamp, query, where, doc, getDoc, getDocs, orderBy, setDoc, updateDoc } from "firebase/firestore";
import { TRIBE_FULL_NAME_BY_SLUG as TRIBE_NAME } from "../constants/tribes";

//測驗題目存至資料庫
export const uploadQuizDB = async (level_ch, data, tribe = "tayal") => {
    const correctAnswers = data.map(q => q.answer);
    // 正確答案不該進到 firestore.rules 裡任何登入使用者都能讀的 quizs 文件——
    // 寫入前先把每題的 answer 拿掉，correctAnswers 保留在記憶體（回傳值 ans）
    // 供這次作答流程使用；真正要長期保存的正確答案改存進 situations（見
    // uploadSituationDB），那份文件本來就只有本人可讀。
    const sanitizedData = data.map(({ answer: _answer, ...rest }) => rest);

    const quizSet = {
        title: level_ch,
        tribe,
        createdAt: serverTimestamp(),
        data: sanitizedData
    };

    try {
        const docRef = await addDoc(collection(db, "quizs"), quizSet);
        return { id: docRef.id, ans: correctAnswers };
    } catch (e) {
        console.error("上傳失敗", e);
        return null;
    }
};
//更新答題情形至資料庫
export const uploadSituationDB = async (quizId, correctAns, userAns, stars) => {
    const results = evaluateAnswers(correctAns, userAns);

    const situationSet = {
        userId: auth.currentUser?.uid,
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
//取得最近的答題情形
export const getCurrentSituation = async () => {
    const user = auth.currentUser;

    if (!user) {
        return [];
    }

    const q = query(
        collection(db, "situations"),
        where("userId", "==", user.uid),
        orderBy("answeredAt", "desc")
    );

    try {
        const querySnapshot = await getDocs(q);
        const situations = [];
        querySnapshot.forEach((doc) => {
            situations.push({
                id: doc.id,
                ...doc.data()
            });
        });

        const enrichedSituations = await Promise.all(
            situations.map(async (s) => {
                if (s.quizId) {
                    try {
                        const quizRef = doc(db, "quizs", s.quizId);
                        const quizSnap = await getDoc(quizRef);
                        if (quizSnap.exists()) {
                            const quizData = quizSnap.data();
                            // 舊資料沒有 tribe 欄位，一律視為泰雅語（該功能上線時唯一支援的語言）
                            const tribe = quizData.tribe || "tayal";
                            const title = quizData.title || "未知";
                            return {
                                ...s,
                                quizType: tribe === "tayal" ? title : `${TRIBE_NAME[tribe] || tribe}-${title}`,
                            };
                        }
                    } catch (err) {
                        console.error(`取得 quiz ${s.quizId} 失敗:`, err);
                    }
                }
                return { ...s, quizType: "未知類型" };
            })
        );
        return enrichedSituations;
    } catch (error) {
        console.error("取得答題情形失敗:", error);
        return [];
    }
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

    try {
        const docRef = doc(db, "calendar", user.uid);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            return data.events || [];
        } else {
            return [];
        }
    } catch (error) {
        console.error("取得行事曆失敗:", error);
        return [];
    }
};

// 新增一筆或多筆行事曆事件。calendar/{uid} 是單一文件、events 是它裡面的
// 一個陣列欄位（不是各自獨立的 Firestore 文件），所以「新增」實際上是讀出
// 整個陣列、在記憶體加上新項目、整包寫回——跟 userServive.jsx 的
// toggleFavoriteWord／updateUserErrors 同一套 read-modify-write 慣例，不是
// 這裡另外發明的模式；多分頁／多裝置同時編輯有遺失更新的風險，這點兩者一致，
// 這裡不特別處理。
//
// 一次寫入多筆（addCalendarEvents）而不是讓呼叫端對每筆各自呼叫
// addCalendarEvent 再用 Promise.all 平行送出：每次呼叫都是獨立的「整包讀出、
// 整包寫回」，平行呼叫會全部讀到同一份舊資料，最後只有最晚寫回的那次生效，
// 其餘會被覆蓋、悄悄遺失（bot_study_plan.jsx 的「全部加入」需要一次寫入好幾筆，
// 就是為了避免這個問題才加這個函式）。
//
// event 補上 client-generated 的 id（陣列本身沒有 Firestore 文件 id 可用），
// 讓刪除／React key 都能用穩定的 id，不必依賴陣列 index。
export const addCalendarEvents = async (events) => {
    const user = auth.currentUser;
    if (!user) throw new Error("請先登入才能新增行程");

    const docRef = doc(db, "calendar", user.uid);
    const docSnap = await getDoc(docRef);
    const existingEvents = docSnap.exists() ? (docSnap.data().events || []) : [];
    const newEvents = events.map((event) => ({ ...event, id: crypto.randomUUID() }));
    const updatedEvents = [...existingEvents, ...newEvents];

    if (docSnap.exists()) {
        await updateDoc(docRef, { events: updatedEvents });
    } else {
        await setDoc(docRef, { events: updatedEvents });
    }
    return newEvents;
};

export const addCalendarEvent = async (event) => {
    const [savedEvent] = await addCalendarEvents([event]);
    return savedEvent;
};

// 依 id 刪除一筆行事曆事件，同樣是整包讀出、過濾、寫回。
export const deleteCalendarEvent = async (eventId) => {
    const user = auth.currentUser;
    if (!user) throw new Error("請先登入才能刪除行程");

    const docRef = doc(db, "calendar", user.uid);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) return;

    const existingEvents = docSnap.data().events || [];
    const updatedEvents = existingEvents.filter((e) => e.id !== eventId);
    await updateDoc(docRef, { events: updatedEvents });
};