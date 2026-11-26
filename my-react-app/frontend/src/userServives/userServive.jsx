import { doc, getDoc, setDoc, updateDoc, runTransaction, increment, FieldPath } from "firebase/firestore";
import { db, auth } from "../../../firebase";
import { onAuthStateChanged, onIdTokenChanged, createUserWithEmailAndPassword, sendEmailVerification } from "firebase/auth";
import { clearAdminSession } from "../_admin/session/adminSession";
import { clearAllConversations, clearOtherConversations } from "../../components/_quiz/botStorage";

// 前端版的角色開發模式開關，對應後端 config/firebase_auth.py 的
// AUTH_DEV_BYPASS_ROLE：後端的 AUTH_DEV_BYPASS 只影響 API 請求，完全不影響
// 這裡（前端讀的是 Firebase 帳號本身的 custom claim），沒有這個開關的話，
// 在 Firebase service account 金鑰設定好、真的執行角色指派之前，本機開發
// 完全看不到 /admin 長什麼樣子。
//
// import.meta.env.DEV 是 Vite 內建、編譯期就決定的常數（`vite dev` 為
// true、`vite build` 為 false），這個 if 分支在正式建置時會被整段 tree-shake
// 掉——就算有人不小心在正式環境的 .env 留了 VITE_AUTH_DEV_BYPASS_ROLE，
// 打包後的產物裡也不會有這段程式碼，不會變成任何使用者都能取得後台權限的破口。
const DEV_BYPASS_ROLE = import.meta.env.DEV
    ? import.meta.env.VITE_AUTH_DEV_BYPASS_ROLE || null
    : null;

//監聽登入
// 快速連續觸發 auth 狀態變換時（例如切換帳號、登入後馬上登出），
// 前一次事件的 getCurrentUser 可能在後一次事件之後才 resolve，
// 若不處理會用舊事件的資料覆蓋掉新事件的結果。用一個世代編號，
// 每次事件開始時遞增，非同步操作完成後比對編號是否仍是最新，
// 不是最新就捨棄這次結果，不呼叫 callback / setupPresence。
//
// callback 收到的可能是「新的使用者狀態物件」，也可能是 (prev) => next 的更新函式：
// 角色更新、個人資料重讀成功、補建個人資料都是在登入之後才發生，這時 AuthContext 裡
// 已經有樂觀更新過的收藏等資料，只能「在目前狀態上改一個欄位」，不能整包換成登入當下的舊快照。
export const authChanges = (callback) => {
    let currentGen = 0;
    let cancelProfileRetry = () => {};

    // FE1-15：onAuthStateChanged 在 token 刷新時不會觸發，角色被授權或撤銷後，原本要等重新登入或
    // 重新整理才看得到。另外訂閱 onIdTokenChanged（每次 token 換新都會觸發，包含每小時的自動刷新
    // 與下面的強制刷新），只更新 role 欄位；個人資料不在這裡重讀，避免每小時多一次 Firestore 讀取。
    const unsubscribeToken = onIdTokenChanged(auth, async (user) => {
        if (!user) return;
        const tokenResult = await user.getIdTokenResult().catch((e) => {
            console.error("[authChanges] getIdTokenResult (token changed) error:", e);
            return null;
        });
        // 讀不到 claim 時不動目前的角色：網路問題不該把有權限的人踢出後台，後端每支 API 仍會驗 claim
        if (!tokenResult) return;
        const role = DEV_BYPASS_ROLE || (tokenResult.claims?.role ?? null);
        callback((prev) => (prev && prev.uid === user.uid && prev.role !== role ? { ...prev, role } : prev));
    });

    // FE1-15：自動刷新最多要等一小時。使用者切回這個分頁時強制換一次 token，讓剛被授權／撤銷的角色
    // 盡快反映；每次強制刷新都是一個 securetoken 請求，所以至少間隔 ROLE_REFRESH_MIN_INTERVAL_MS。
    let lastForcedRefresh = Date.now();
    const onVisibility = () => {
        if (typeof document === "undefined" || document.visibilityState !== "visible") return;
        const current = auth.currentUser;
        if (!current || Date.now() - lastForcedRefresh < ROLE_REFRESH_MIN_INTERVAL_MS) return;
        lastForcedRefresh = Date.now();
        current.getIdToken(true).catch((e) => console.error("[authChanges] forced token refresh error:", e));
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);

    // FE1-04：註冊失敗後當場補建的個人資料（只在畫面上還是同一位、仍沒有完整資料時套用）
    const onProfileBackfilled = (uid, data) => callback((prev) => (
        prev?.uid === uid && (!prev.firestoreData || prev.firestoreData.profileUnavailable)
            ? { ...prev, firestoreData: data }
            : prev
    ));
    _profileListeners.add(onProfileBackfilled);

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
        const myGen = ++currentGen;
        cancelProfileRetry();
        cancelProfileRetry = () => {};
        if (user) {
            // 先清（在下面任何 await 之前）：讀 profile、token 可能很慢，這段時間上一位的 AI 對話不該還留在這台裝置上
            clearOtherConversations(user.uid);
            // getIdTokenResult 才拿得到 custom claims（role），一般的 user 物件
            // 本身不帶這個資訊。後台管理系統的 AdminRoute 靠 role 判斷能不能進去
            // （見 backend/config/roles.py），這裡是前端唯一讀取這個 claim 的地方，
            // 避免每個要用到角色的元件各自呼叫一次 getIdTokenResult。失敗時
            // （例如網路問題）不讓整個登入流程掛掉，只是把角色當作沒有，安全的
            // 失敗方向是「當成一般使用者」而不是「當成有權限」。
            const [profile, tokenResult] = await Promise.all([
                readUserProfile(user.uid),
                user.getIdTokenResult().catch((e) => {
                    console.error("[authChanges] getIdTokenResult error:", e);
                    return null;
                }),
            ]);
            if (myGen !== currentGen) return;

            setupPresence(user.uid).catch((e) => {
                console.error("[authChanges] setupPresence error:", e);
            });

            const role = DEV_BYPASS_ROLE || (tokenResult?.claims?.role ?? null);
            const isStale = () => myGen !== currentGen;

            if (profile.status === "error") {
                // FE1-03：讀取失敗（離線、逾時、規則拒絕）時使用者其實已登入。原本回傳 null，導覽列以
                // firestoreData 判斷登入，就顯示「登入」而且沒有登出入口。改成給一份標記
                // profileUnavailable 的降級資料（名稱、Email 取自 Auth 帳號本身），並在背景重讀。
                // 若這時已經有同一位使用者的完整資料（例如註冊表單剛補上），AuthContext 會保留它。
                callback({ firestoreData: buildFallbackProfile(user), uid: user.uid, role });
                cancelProfileRetry = scheduleProfileRetry(user.uid, isStale, callback);
                return;
            }

            callback({
                firestoreData: profile.data,
                uid: user.uid,
                role,
            });
            initUserFields(user.uid).then((created) => {
                // FE1-04：文件不存在、這次補建了預設資料，就把它交給畫面（只在仍是同一位、仍沒有資料時）
                if (!created || isStale()) return;
                callback((prev) => (prev?.uid === user.uid && !prev.firestoreData ? { ...prev, firestoreData: created } : prev));
            });
        } else {
            // 登出（或登入狀態消失）時一併清掉「已在後台登入頁輸入過密碼」的旗標，
            // 否則同一分頁重新用前台登入同一個帳號，就會不用再輸入密碼直接進後台
            clearAdminSession();
            // 被動登出（token 失效、其他分頁登出）也要清：AI 對話是學生的提問，不留在共用裝置上
            clearAllConversations();
            stopPresence();
            callback(null);
        }
    });

    return () => {
        cancelProfileRetry();
        _profileListeners.delete(onProfileBackfilled);
        unsubscribeAuth();
        unsubscribeToken();
        if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    };
};

// FE1-15：切回分頁時強制刷新 token 的最小間隔。授權／撤銷角色是低頻操作，五分鐘內反映就夠，
// 不需要每次切換分頁都多打一個 securetoken 請求。
const ROLE_REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000;

// FE1-03：個人資料讀取失敗後的重讀間隔；用完之後只等瀏覽器回到線上（online 事件）再試。
const PROFILE_RETRY_DELAYS_MS = [3000, 10000, 30000];

// FE1-03：讀取失敗時的降級使用者資料。只放畫面需要的欄位（導覽列的名稱與頭像、登出入口），
// 收藏是空的；這份資料絕對不能被寫回 Firestore——目前收藏寫入（setFavoriteWord）與
// updateProfile 都在伺服器端重讀文件，不會拿它整包覆蓋。
// 名稱同樣不取 Email 的任何部分：降級資料雖然不寫回 users，但筆記分享（_note/index.jsx）直接拿
// context 的 firestoreData.name 寫進公開的 sharedNotes.username，降級期間分享就會把 Email 前段公開。
function buildFallbackProfile(user) {
    const email = user?.email || "";
    const displayName = typeof user?.displayName === "string" ? user.displayName.trim() : "";
    return {
        name: displayName || "使用者",
        email,
        identity: "",
        favorites: [],
        user_errors: {},
        avatarUrl: user?.photoURL || null,
        profileUnavailable: true,
    };
}

// FE1-03：背景重讀個人資料。成功就把降級資料換成真的（只在畫面上還是同一位使用者、仍是降級資料時）；
// 文件確定不存在就交給 initUserFields 補建。回傳取消函式，登出或換帳號時停止。
function scheduleProfileRetry(uid, isStale, callback) {
    let timer = null;
    let attempt = 0;
    let done = false;
    const replaceFallback = (data) => callback((prev) => (
        prev?.uid === uid && (!prev.firestoreData || prev.firestoreData.profileUnavailable)
            ? { ...prev, firestoreData: data }
            : prev
    ));
    const cancel = () => {
        done = true;
        clearTimeout(timer);
        if (typeof window !== "undefined") window.removeEventListener("online", retryNow);
    };
    async function retryNow() {
        if (done || isStale()) return cancel();
        clearTimeout(timer);
        const profile = await readUserProfile(uid);
        if (done || isStale()) return cancel();
        if (profile.status === "ok") {
            cancel();
            replaceFallback(profile.data);
            return;
        }
        if (profile.status === "missing") {
            cancel();
            const created = await initUserFields(uid);
            if (created && !isStale()) replaceFallback(created);
            return;
        }
        scheduleNext();
    }
    function scheduleNext() {
        if (attempt >= PROFILE_RETRY_DELAYS_MS.length) return; // 剩下只靠 online 事件
        timer = setTimeout(retryNow, PROFILE_RETRY_DELAYS_MS[attempt]);
        attempt += 1;
    }
    if (typeof window !== "undefined") window.addEventListener("online", retryNow);
    scheduleNext();
    return cancel;
}

// FE1-03：區分「文件不存在」（新帳號、註冊中）與「讀取失敗」（離線、逾時、規則拒絕）。
// 兩者原本都回傳 null，呼叫端分不出該補建資料還是該稍後重讀。
async function readUserProfile(uid) {
    try {
        const docSnap = await getDoc(doc(db, "users", uid));
        return docSnap.exists() ? { status: "ok", data: docSnap.data() } : { status: "missing", data: null };
    } catch (error) {
        console.error("取得currentUser失敗: ", error);
        return { status: "error", data: null, error };
    }
}

//取得firestore的使用者資料（不存在或讀取失敗都回傳 null；需要分辨兩者時用 readUserProfile）
export const getCurrentUser = async (uid) => (await readUserProfile(uid)).data;

// 新帳號的預設收藏分類。用 factory（而不是模組層常數陣列）是因為
// registerWithImg／initUserFields 各自要寫進不同使用者的 Firestore 文件，
// 若共用同一個陣列參照，其中一份文件的巢狀物件理論上可能被意外共用/修改。
function createDefaultFavorites() {
    return [
        { id: 1, title: "基礎詞彙", content: [] },
        { id: 2, title: "日常對話", content: [] },
        { id: 3, title: "旅遊用語", content: [] },
    ];
}

// FE1-04：註冊進行中（帳號已建、個人資料還沒寫完）時，authChanges 會先收到「文件不存在」。
// 這段期間 initUserFields 不能補建預設資料：補建先寫進去的話，註冊的 setDoc 會變成「更新」，
// 被規則擋下（email、joinDate 不可改），反而讓註冊失敗。用計數而不是布林，避免多次呼叫互相蓋掉。
let _registrationsInFlight = 0;

// FE1-04：個人資料寫入的重試次數與間隔（第一次失敗後再試一次）
const PROFILE_WRITE_ATTEMPTS = 2;
const PROFILE_WRITE_RETRY_MS = 800;

/** FE1-04：帳號建好但個人資料寫不進去時丟出的錯誤。
 * - accountRemoved：已把剛建立的帳號刪掉，使用者可以用同一個 Email 重新註冊。
 * - accountRemoved 為 false：刪除也失敗，帳號還在而且這個分頁仍是登入狀態。這時會當場用預設值
 *   補建一次個人資料；backfilledData 有值表示補建成功（畫面已經拿到資料），沒有值表示補建也失敗，
 *   之後重新整理或重新登入時 initUserFields 會再補。 */
export class ProfileWriteError extends Error {
    constructor(cause, accountRemoved, backfilledData = null) {
        let message;
        if (accountRemoved) message = "建立個人資料失敗，帳號沒有建立，請稍後再註冊一次";
        else if (backfilledData) message = "帳號已建立，但部分個人資料沒有存好，已先用預設值建立，可以到個人資料頁修改名稱與頭像";
        else message = "帳號已建立，但個人資料沒有存好；請重新整理頁面，或稍後用這組 Email 與密碼登入，系統會自動補上資料";
        super(message);
        this.name = "ProfileWriteError";
        this.code = "app/profile-write-failed";
        this.accountRemoved = accountRemoved;
        this.backfilledData = backfilledData;
        this.cause = cause;
    }
}

// FE1-04：authChanges 以外的地方（目前只有註冊失敗後的補建）補好個人資料時，通知每個 authChanges
// 訂閱者把資料交給畫面。這個分頁註冊時的登入事件已經過去，不會再有 onAuthStateChanged 幫忙重讀。
const _profileListeners = new Set();
function notifyProfileBackfilled(uid, data) {
    _profileListeners.forEach((listener) => listener(uid, data));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// FE1-04 註冊競態：_registrationsInFlight 只存在這個分頁。另一個分頁（同一個瀏覽器共用登入狀態）
// 可能先用 initUserFields 補建了文件，這時這裡的 setDoc 會變成「更新」而被規則拒絕（email、
// joinDate 不可改）。寫入失敗後先看文件是否已經存在：存在就當作成功、不再重寫也不刪帳號
// （刪帳號會留下沒有帳號的 users 文件，規則不允許刪除），再用規則允許的欄位補上使用者填的資料。
async function adoptExistingProfile(userRef, wanted) {
    const snap = await getDoc(userRef).catch(() => null);
    if (!snap?.exists()) return null;
    const existing = snap.data();
    const updates = {};
    for (const key of ["name", "identity", "avatarUrl"]) {
        if (wanted[key] !== undefined && wanted[key] !== existing[key]) updates[key] = wanted[key];
    }
    if (Object.keys(updates).length === 0) return existing;
    try {
        await updateDoc(userRef, updates);
        return { ...existing, ...updates };
    } catch (e) {
        // 補不上使用者填的名稱也沒關係：文件已經存在，帳號可正常使用，名稱可以之後在個人資料頁改
        console.error("X 套用註冊資料到既有文件失敗: ", e?.code, e?.message);
        return existing;
    }
}

export const registerWithImg = async (name, email, password, identity, avatarUrl) => {
    _registrationsInFlight += 1;
    let inFlightReleased = false;
    const releaseInFlight = () => {
        if (inFlightReleased) return;
        inFlightReleased = true;
        _registrationsInFlight -= 1;
    };
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        //把其他需要的資料存到firestore的users
        let firestoreData = {
            name: name,
            email: email,
            identity: identity,
            favorites: createDefaultFavorites(),
            user_errors: {},
            joinDate: new Date().toISOString(),
            avatarUrl: avatarUrl
        };
        // FE1-04：原本 setDoc 一失敗就整段丟出，留下「已登入、沒有個人資料」的帳號，重新註冊只會得到
        // 「電子郵件已註冊」。先重試；仍失敗就刪掉剛建立的帳號（剛建立的帳號是剛登入的，
        // 不會遇到 requires-recent-login），讓使用者可以重新註冊。刪除也失敗時保留帳號，
        // 由 initUserFields 在之後的登入補建資料，並用錯誤訊息說明實際狀態。
        const userRef = doc(db, "users", user.uid);
        let lastWriteError = null;
        for (let attempt = 0; attempt < PROFILE_WRITE_ATTEMPTS; attempt += 1) {
            try {
                await setDoc(userRef, firestoreData);
                lastWriteError = null;
                break;
            } catch (writeError) {
                lastWriteError = writeError;
                // 文件已被別的分頁建好（見 adoptExistingProfile）：當作成功，不再重寫
                const adopted = await adoptExistingProfile(userRef, firestoreData);
                if (adopted) {
                    firestoreData = adopted;
                    lastWriteError = null;
                    break;
                }
                if (attempt + 1 < PROFILE_WRITE_ATTEMPTS) await sleep(PROFILE_WRITE_RETRY_MS);
            }
        }
        if (lastWriteError) {
            let accountRemoved = false;
            try {
                await user.delete();
                accountRemoved = true;
            } catch (deleteError) {
                console.error("X 刪除未完成註冊的帳號失敗: ", deleteError?.code, deleteError?.message);
            }
            let backfilled = null;
            if (!accountRemoved) {
                // 帳號還在、這個分頁仍是登入狀態：先放掉「註冊中」旗標（否則 initUserFields 會略過），
                // 當場補建一次並通知畫面，不必等重新整理。補建失敗（回傳 null）時保留原本的錯誤說明。
                releaseInFlight();
                backfilled = await initUserFields(user.uid);
                if (backfilled) notifyProfileBackfilled(user.uid, backfilled);
            }
            throw new ProfileWriteError(lastWriteError, accountRemoved, backfilled);
        }

        // 寄出 Email 驗證信（Email 打錯字的帳號才有機會被發現）。寄信失敗不影響註冊本身，
        // 使用者之後仍可正常登入，所以只記錄、不丟出錯誤。
        try {
            await sendEmailVerification(user);
        } catch (verificationError) {
            console.error("寄送驗證信失敗: ", verificationError?.code, verificationError?.message);
        }

        // 帳號建立時 Firebase 就已經登入了；回傳剛寫入的資料，讓呼叫端（註冊表單）能直接更新
        // 全站使用者資料，不必再手動登入一次。
        return { uid: user.uid, firestoreData };
    } catch (error) {
        console.error("X 註冊錯誤: ", error.code, error.message);
        throw error;
    } finally {
        releaseInFlight();
    }
};

export const updateProfile = async (uid, newData) => {
    try {
        const userRef = doc(db, "users", uid);
        const docSnap = await getDoc(userRef);

        if (!docSnap.exists()) {
            throw new Error("使用者資料不存在");
        }

        const oldData = docSnap.data();

        const updates = {};
        if (newData.name !== oldData.name) updates.name = newData.name;
        if (newData.identity !== oldData.identity) updates.identity = newData.identity;
        if (newData.avatarUrl !== oldData.avatarUrl) updates.avatarUrl = newData.avatarUrl;

        if (Object.keys(updates).length === 0) {
            return { success: false, message: "沒有更新的資料" };
        }

        await updateDoc(userRef, updates);

        const completeUserData = {
            ...oldData,
            ...updates
        };

        return {
            success: true,
            firestoreData: completeUserData,
            uid: uid
        };

    } catch (error) {
        console.error("X 更新失敗: ", error.code, error.message);
        throw error;
    }
};

// FE1-04：補建個人資料用的預設值，欄位與 registerWithImg 寫入的一致（firestore.rules 的 create 規則
// 要求 name／email／identity／favorites／user_errors／joinDate 都在、email 與 token 相同）。
// 名稱只沿用 Auth 帳號本身的 displayName，沒有就用中性的「使用者」，絕不取 Email 的任何部分：
// 這份資料會真的寫進 Firestore，分享筆記時 name 會公開寫進 sharedNotes.username，
// 用 Email 前段等於把使用者的 Email 公開出去。使用者之後可以在個人資料頁修改。
function buildBackfillProfile(user) {
    const email = user?.email;
    if (!email) return null;
    const displayName = typeof user.displayName === "string" ? user.displayName.trim().slice(0, 100) : "";
    return {
        name: displayName || "使用者",
        email,
        identity: "學生",
        favorites: createDefaultFavorites(),
        user_errors: {},
        joinDate: new Date().toISOString(),
        avatarUrl: user.photoURL || null,
    };
}

// 補齊舊帳號缺少的欄位；FE1-04 起，文件不存在時也用預設值補建（例如註冊時個人資料沒寫進去、
// 又沒能刪掉帳號的情況），否則這種帳號永遠沒有資料。補建了就回傳那份資料，否則回傳 null。
// 用 transaction：「讀到不存在 → 建立」中間若有別的分頁或註冊流程先建好，會重跑並改成不寫。
export const initUserFields = async (uid) => {
    try {
        const userRef = doc(db, "users", uid);
        return await runTransaction(db, async (tx) => {
            const userSnap = await tx.get(userRef);

            if (!userSnap.exists()) {
                const current = auth.currentUser;
                // 註冊中由 registerWithImg 自己寫；登入的已經不是這位使用者也不補
                if (_registrationsInFlight > 0 || !current || current.uid !== uid) return null;
                const created = buildBackfillProfile(current);
                if (!created) return null;
                tx.set(userRef, created);
                return created;
            }

            const data = userSnap.data();
            const updateData = {};
            if (!data.favorites) updateData.favorites = createDefaultFavorites();
            if (!data.user_errors) updateData.user_errors = {};
            if (Object.keys(updateData).length > 0) tx.update(userRef, updateData);
            return null;
        }) ?? null;
    } catch (error) {
        console.error("X 初始化欄位失敗：", error.message);
        return null;
    }
};

// 失敗時往上拋，讓呼叫端（useFavorites hook）決定要不要還原樂觀更新、
// 在畫面上提示使用者，而不是在這裡默默吞掉錯誤。
//
// FE1-01：原本是 toggleFavoriteWord，在 transaction 內依伺服器目前內容「有就刪、沒有就加」。
// 但畫面上的收藏只在登入時讀一次，A 分頁已加入某詞、B 分頁還是舊資料時，在 B 按「加入」
// 會讓伺服器把它刪掉，B 卻顯示「已加入收藏」，而且 transaction 成功也不會觸發還原。
// 改成「設成」語意：呼叫端傳入目標狀態 shouldContain，已經是目標狀態就不寫入，
// 所以不論伺服器那邊被別的分頁改成怎樣，結果都是使用者在這個畫面上想要的狀態。
export const setFavoriteWord = async (uid, wordTayal, favId = 1, shouldContain = true) => {
    try {
        const userRef = doc(db, "users", uid);
        // 用 transaction 包住「讀出 favorites → 改 → 整包寫回」：原本兩個分頁／裝置
        // 同時收藏時，各自讀到同一份舊陣列，後寫回的那次會把先寫回的那次整個蓋掉。
        // transaction 在文件被別處改過時會自動重讀、重跑這段函式，不會遺失更新。
        // 回呼內只能做「讀、算、寫」，不要放有副作用的事（可能被重跑多次）。
        await runTransaction(db, async (tx) => {
            const userSnap = await tx.get(userRef);

            if (!userSnap.exists()) {
                throw new Error("使用者資料不存在");
            }

            const userData = userSnap.data();
            const favorites = userData.favorites || [];

            let changed = false;
            const updatedFavorites = favorites.map(fav => {
                if (fav.id !== favId) return fav;
                const content = Array.isArray(fav.content) ? fav.content : [];
                const exists = content.includes(wordTayal);
                if (exists === shouldContain) return fav;
                changed = true;
                return {
                    ...fav,
                    content: shouldContain ? [...content, wordTayal] : content.filter(w => w !== wordTayal),
                };
            });

            // 已經是目標狀態（例如別的分頁剛做了同一件事）：不寫，省一次寫入也不會改動別的欄位
            if (changed) tx.update(userRef, { favorites: updatedFavorites });
        });
    } catch (err) {
        console.error("X 收藏寫入失敗：", err.message);
        throw err;
    }
};

// 答錯次數用 Firestore 伺服器端的原子 increment()，不再「讀出整個 user_errors
// map → 加一 → 整包寫回」：原本兩個分頁同時答錯會互相覆蓋、次數被低估，而這份
// 統計會餵給 AI 助手做個人化建議。FieldPath 把單字當成單一欄位名稱，單字裡就算
// 含有「.」也不會被誤解成巢狀路徑。
export const updateUserErrors = async (uid, wordTayal, incrementBy = 1) => {
  if (!wordTayal) return;
  try {
    const userRef = doc(db, "users", uid);
    await updateDoc(userRef, new FieldPath("user_errors", wordTayal), increment(incrementBy));
  } catch (err) {
    // 使用者文件不存在時沒有東西可累加，維持原本「靜默略過」的行為
    if (err?.code === "not-found") return;
    console.error("X 更新答錯次數失敗：", err.message);
  }
};

//登出
// 失敗時往上拋，讓呼叫端（userSidebar.jsx）決定怎麼在畫面上提示使用者，
// 而不是在這個不屬於任何元件的共用函式裡直接跳 alert()。
export const signOut = async () => {
    try {
        await auth.signOut();
        // 登出成功才清：登出失敗時使用者還在這個帳號裡，不該弄丟對話
        clearAllConversations();
    } catch (error) {
        console.error("X 登出失敗: ", error.message);
        throw error;
    }
};

// 監聽上線狀態
// authChanges 每次 auth 狀態改變都會呼叫一次 setupPresence，
// 如果不先取消上一個 onValue 訂閱，舊的 listener 會一直留著，
// 累積下去造成 memory leak，所以用一個模組層級的變數記住目前的 unsubscribe，
// 每次要建立新的監聽前先把舊的取消掉。
let _presenceUnsubscribe = null;

// 登出時呼叫，取消目前的 presence 監聽。原本 authChanges 的登出分支只呼叫
// callback(null)，沒有清掉這個 listener——要等下一次登入呼叫 setupPresence
// 時才會被「順便」取消，這段期間一個已登出的分頁還在對 RTDB 寫入 presence 狀態。
// _presenceGen 讓「還在下載 Realtime Database SDK」的 setupPresence 在登出或再次登入時作廢。
let _presenceGen = 0;

export const stopPresence = () => {
    _presenceGen += 1;
    if (_presenceUnsubscribe) {
        _presenceUnsubscribe();
        _presenceUnsubscribe = null;
    }
};

// Realtime Database SDK 約佔入口 chunk 的一成，而且只有登入後的上線狀態會用到，
// 所以用動態 import 在登入後才下載，沒登入的訪客不會載入它（審查項 P2-102）。
export const setupPresence = async (uid) => {
    stopPresence();
    const generation = _presenceGen;
    const { getDatabase, ref, onDisconnect, set, onValue, serverTimestamp } = await import("firebase/database");
    if (generation !== _presenceGen) return;

    const db = getDatabase();
    const statusRef = ref(db, `/status/${uid}`);
    const connectedRef = ref(db, ".info/connected");

    // 確認使用者是否連上 RTDB
    _presenceUnsubscribe = onValue(connectedRef, async (snap) => {
        if (snap.val() === false) {
            return;
        }

        try {
            //下線
            await onDisconnect(statusRef).set({
                state: "offline",
                lastChanged: serverTimestamp(),
            });

            // 等待期間若已登出或換帳號，就不要再寫入「上線」
            if (generation !== _presenceGen) return;

            //上線
            await set(statusRef, {
                state: "online",
                lastChanged: serverTimestamp(),
            });
        } catch (e) {
            console.error("[presence] error while setting presence:", e);
        }
    }, (err) => {
        console.error("[presence] .info/connected error:", err);
    });
};
