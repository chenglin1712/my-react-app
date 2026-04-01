import { doc, getDoc, getDocs, setDoc, updateDoc, collection } from "firebase/firestore";
import { getDatabase, ref, onDisconnect, set, onValue, serverTimestamp } from "firebase/database";
import { db, auth } from "../../../firebase";
import { onAuthStateChanged, createUserWithEmailAndPassword } from "firebase/auth";

//監聽登入
export const authChanges = (callback) => {
    return onAuthStateChanged(auth, async (user) => {
        if (user) {
            const userData = await getCurrentUser(user.uid);

            try {
                setupPresence(user.uid);
            } catch (e) {
                console.error("[authChanges] setupPresence error:", e);
            }

            callback({ firestoreData: userData, uid: user.uid });
            initUserFields(user.uid);
        } else {
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

//取得所有使用者
export const getAllUsers = async () => {
    try {
        const docSnap = await getDocs(collection(db, "users"));
        const users = docSnap.docs.map((doc) => ({
            id: doc.id,
            ...doc.data()
        }));
        return users;
    } catch (error) {
        console.error("取得所有使用者失敗: ", error);
        return [];
    }
};

export const registerWithImg = async (name, email, password, identity, avatarUrl) => {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        //把其他需要的資料存到firestore的users
        await setDoc(doc(db, "users", user.uid), {
            name: name,
            email: email,
            identity: identity,
            favorites: [
                {
                    id: 1,
                    title: "基礎詞彙",
                    content: []
                },
                {
                    id: 2,
                    title: "日常對話",
                    content: []
                },
                {
                    id: 3,
                    title: "旅遊用語",
                    content: []
                }
            ],
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
            updateData.favorites = [
                { id: 1, title: "基礎詞彙", content: [] },
                { id: 2, title: "日常對話", content: [] },
                { id: 3, title: "旅遊用語", content: [] }
            ];
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

export const toggleFavoriteWord = async (uid, wordTayal) => {
    try {
        const userRef = doc(db, "users", uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            const userData = userSnap.data();
            const favorites = userData.favorites || [];

            const updatedFavorites = favorites.map(fav => {
                if (fav.id === 1) {
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
        } else {
            console.error("X 使用者不存在");
        }
    } catch (err) {
        console.error("X 收藏寫入失敗：", err.message);
    }
};

export const updateUserErrors = async (uid, wordTayal, increment = 1) => {
  try {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return;

    const userData = userSnap.data();
    const errors = userData.user_errors || {};
    errors[wordTayal] = (errors[wordTayal] || 0) + increment;

    await updateDoc(userRef, { user_errors: errors });
  } catch (err) {
    console.error("X 更新答錯次數失敗：", err.message);
  }
};

//登出
export const signOut = async () => {
    try {
        await auth.signOut();
    } catch (error) {
        console.error("X 登出失敗: ", error.message);
        alert("登出失敗：" + error.message);
    }
};

// 監聽上線狀態
export const setupPresence = (uid) => {
    const db = getDatabase();
    const statusRef = ref(db, `/status/${uid}`);
    const connectedRef = ref(db, ".info/connected");

    // 確認使用者是否連上 RTDB
    onValue(connectedRef, async (snap) => {
        // console.log("[presence] .info/connected =", snap.val());

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
