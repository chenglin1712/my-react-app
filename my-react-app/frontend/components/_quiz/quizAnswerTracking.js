// P5.3 題目品質分析：算出一次測驗作答要送出的 quiz_answer 追蹤事件清單。
// 抽成獨立模組（不是留在 quiz_panel.jsx 裡）有兩個理由：(1) quiz_panel.jsx
// 有 lottie-web 這種在模組載入當下就會執行副作用的相依套件，測試環境
// import 整個元件檔案容易連帶炸掉，純函式獨立成檔案就不會被牽連；(2) 純函式
// 混在元件檔案裡 export 會觸發 react-refresh/only-export-components 警告。
//
// 純函式（不碰任何 hook/DOM），呼叫端（quiz_panel.jsx 的 handleSubmmit）
// 只負責把回傳的事件逐一丟給 trackEvent()——那個函式本身是 fire-and-forget，
// 呼叫端不需要 await。
//
// 不改動既有的 Firestore 寫入路徑（answers/correctAnswers/results 依然是
// 純陣列位置對應），這只是並行多送一份「答的是哪一題」的輕量訊號。配合題
// （matching）一「題」其實是好幾個 QuizVocabItem 組成的題組，沒有單一
// item_id 代表整題，改成逐 pair 各記一筆、用整個題組的對錯當作每個 pair
// 的近似結果（見 backend/crawler/views.py build_matching_test_from_db 的
// 說明）；其餘題型是題目本身就帶 item_id。未作答的題目（userAnswers[i]
// 是 null）不計入，「沒作答」不是「答錯」，不該污染這一題的答對率統計。
export function buildQuizAnswerEvents(data, quizInfo, userAnswers, tribe, level) {
    const questions = data?.parts?.[0]?.questions;
    if (!quizInfo || !questions) return [];
    const currentType = data.parts[0].type;
    const events = [];

    questions.forEach((question, index) => {
        const userAnswer = userAnswers[index];
        if (userAnswer == null) return;
        const correct = userAnswer === quizInfo.ans?.[index];

        if (currentType === "matching") {
            (question.pairs ?? []).forEach((pair) => {
                if (pair.item_id == null) return;
                events.push({
                    eventType: "quiz_answer",
                    tribe,
                    payload: { item_kind: currentType, item_id: pair.item_id, level, correct },
                });
            });
        } else if (question.item_id != null) {
            events.push({
                eventType: "quiz_answer",
                tribe,
                payload: { item_kind: currentType, item_id: question.item_id, level, correct },
            });
        }
    });

    return events;
}
