import { db, auth } from "../../../firebase";
import { collection, addDoc, serverTimestamp, query, where, doc, getDoc, getDocs, orderBy } from "firebase/firestore";

//測驗題目存至資料庫
export const uploadQuizDB = async (level_ch, data) => {
    const correctAnswers = data.map(q => q.answer);

    const quizSet = {
        title: level_ch,
        createdAt: serverTimestamp(),
        data
    };

    try {
        const docRef = await addDoc(collection(db, "quizs"), quizSet);
        // console.log("成功上傳測驗 ID:", docRef.id);
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
        answers: userAns,
        results: results
    }

    try {
        const docRef = await addDoc(collection(db, "situations"), situationSet);
        // console.log("成功上傳答題情形 ID:", docRef.id);
        return docRef.id
    } catch (e) {
        console.error("上傳失敗", e);
    }
};

//比對回答是否正確
const evaluateAnswers = (correctAns, userAns) => {
    return correctAns.map((correctAnswer, index) => {
        const userAnswer = userAns[index];
        let questionSituation;
        if (userAnswer == null || userAnswer == undefined) {
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
    }
};
//取得最近的答題情形
export const getCurrentSituation = async () => {
    const user = auth.currentUser;

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
                            return {
                                ...s,
                                quizType: quizSnap.data().title || "未知",
                            };
                        }
                    } catch (err) {
                        console.error(`取得 quiz ${s.quizId} 失敗:`, err);
                    }
                }
                return { ...s, quizType: "未知類型" };
            })
        );
        // console.log("取得的答題情形：", situations);
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
                monthlyAccuracy: data.monthlyAccuracy || {},
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
                averageAccuracy: averagesMap.get(item.type) || null,
            }));
        }

        let mergedAccuracyByMonth = [];
        if (userData.monthlyAccuracy && globalData.allUsersMonthlyAccuracy) {
            const averagesMap = new Map(
                globalData.allUsersMonthlyAccuracy.map(item => [item.date, item.averageAccuracy])
            );

            mergedAccuracyByMonth = userData.monthlyAccuracy.map(item => ({
                ...item,
                averageAccuracy: averagesMap.get(item.date) || null,
            }));
        }

        const allData = { ...userData, accuracyByType: mergedAccuracyByType, monthlyAccuracy: mergedAccuracyByMonth };

        if (Object.keys(allData).length === 0) {
            // 無資料
            return null;
        }
        return allData;

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