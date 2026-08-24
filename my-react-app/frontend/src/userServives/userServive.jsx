import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { getDatabase, ref, onDisconnect, set, onValue, serverTimestamp } from "firebase/database";
import { db, auth } from "../../../firebase";
import { onAuthStateChanged, createUserWithEmailAndPassword } from "firebase/auth";

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
export const authChanges = (callback) => {
    let currentGen = 0;
    return onAuthStateChanged(auth, async (user) => {
        const myGen = ++currentGen;
        if (user) {
            // getIdTokenResult 才拿得到 custom claims（role），一般的 user 物件
            // 本身不帶這個資訊。後台管理系統的 AdminRoute 靠 role 判斷能不能進去
            // （見 backend/config/roles.py），這裡是前端唯一讀取這個 claim 的地方，
            // 避免每個要用到角色的元件各自呼叫一次 getIdTokenResult。失敗時
            // （例如網路問題）不讓整個登入流程掛掉，只是把角色當作沒有，安全的
            // 失敗方向是「當成一般使用者」而不是「當成有權限」。
            const [userData, tokenResult] = await Promise.all([
                getCurrentUser(user.uid),
                user.getIdTokenResult().catch((e) => {
                    console.error("[authChanges] getIdTokenResult error:", e);
                    return null;
                }),
            ]);
            if (myGen !== currentGen) return;

            try {
                setupPresence(user.uid);
            } catch (e) {
                console.error("[authChanges] setupPresence error:", e);
            }

            callback({
                firestoreData: userData,
                uid: user.uid,
                role: DEV_BYPASS_ROLE || (tokenResult?.claims?.role ?? null),
            });
            initUserFields(user.uid);
        } else {
            stopPresence();
            callback(null);
        }
    });
};

//取得firestore的使用者資料
export const getCurrentUser = async (uid) => {
    try {
        const docRef = doc(db, "users", uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            return docSnap.data();
        }
        return null;
    } catch (error) {
        console.error("取得currentUser失敗: ", error);
        return null;
    }
};

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

export const registerWithImg = async (name, email, password, identity, avatarUrl) => {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        //把其他需要的資料存到firestore的users
        await setDoc(doc(db, "users", user.uid), {
            name: name,
            email: email,
            identity: identity,
            favorites: createDefaultFavorites(),
            user_errors: {},
            joinDate: new Date().toISOString(),
            avatarUrl: avatarUrl
        });

    } catch (error) {
        console.error("X 註冊錯誤: ", error.code, error.message);
        throw error;
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

export const initUserFields = async (uid) => {
    try {
        const userRef = doc(db, "users", uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
            console.error("X 使用者資料不存在");
            return;
        }

        const data = userSnap.data();
        const updateData = {};
        const addedFields = [];

        if (!data.favorites) {
            updateData.favorites = createDefaultFavorites();
            addedFields.push("favorites");
        }

        if (!data.user_errors) {
            updateData.user_errors = {};
            addedFields.push("user_errors");
        }

        if (Object.keys(updateData).length > 0) {
            await updateDoc(userRef, updateData);
        }

    } catch (error) {
        console.error("X 初始化欄位失敗：", error.message);
    }
};

// 失敗時往上拋，讓呼叫端（useFavorites hook）決定要不要還原樂觀更新、
// 在畫面上提示使用者，而不是在這裡默默吞掉錯誤。
export const toggleFavoriteWord = async (uid, wordTayal, favId = 1) => {
    try {
        const userRef = doc(db, "users", uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
            throw new Error("使用者資料不存在");
        }

        const userData = userSnap.data();
        const favorites = userData.favorites || [];

        const updatedFavorites = favorites.map(fav => {
            if (fav.id === favId) {
                const content = Array.isArray(fav.content) ? fav.content : [];
                const exists = content.includes(wordTayal);
                const newContent = exists
                    ? content.filter(w => w !== wordTayal)
                    : [...content, wordTayal];
                return { ...fav, content: newContent };
            }
            return fav;
        });

        await updateDoc(userRef, { favorites: updatedFavorites });
    } catch (err) {
        console.error("X 收藏寫入失敗：", err.message);
        throw err;
    }
};

export const updateUserErrors = async (uid, wordTayal, increment = 1) => {
  try {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return;

    const userData = userSnap.data();
    const errors = { ...(userData.user_errors || {}) };
    errors[wordTayal] = (errors[wordTayal] || 0) + increment;

    await updateDoc(userRef, { user_errors: errors });
  } catch (err) {
    console.error("X 更新答錯次數失敗：", err.message);
  }
};

//登出
// 失敗時往上拋，讓呼叫端（userSidebar.jsx）決定怎麼在畫面上提示使用者，
// 而不是在這個不屬於任何元件的共用函式裡直接跳 alert()。
export const signOut = async () => {
    try {
        await auth.signOut();
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
export const stopPresence = () => {
    if (_presenceUnsubscribe) {
        _presenceUnsubscribe();
        _presenceUnsubscribe = null;
    }
};

export const setupPresence = (uid) => {
    const db = getDatabase();
    const statusRef = ref(db, `/status/${uid}`);
    const connectedRef = ref(db, ".info/connected");

    stopPresence();

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
