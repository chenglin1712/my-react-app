import News from "../../components/_home/news"
import FunctionBtn from "../../components/_home/functionBtn"
import "../../static/css/_home/index.css"
import Calendar from "../../components/_home/calendar"
import { useEffect, useState } from 'react';
import BannerImg from "../../static/assets/_home/home.webp"

const App = ({ }) => {
    const [newsWithImage, setNewsWithImage] = useState([]);
    const [newsWithoutImage, setNewsWithoutImage] = useState([]);
    const [examInfo, setExamInfo] = useState([]);

    useEffect(() => {
        fetch(`${import.meta.env.VITE_API_NEWS_URL}`)
            .then((res) => res.json())
            .then((data) => {
                const exams = data.filter((item) => item.isExam === "T");
                const news = data.filter((item) => item.isExam !== "T");

                setExamInfo(exams);

                const withImg = news.filter((item) => item.image);
                const withoutImg = news.filter((item) => !item.image);
                setNewsWithImage(withImg);
                setNewsWithoutImage(withoutImg);
            });
    }, []);

    return (
        <div className="homepage">
            <img src={BannerImg} className="banner-img" />
            <div className="banner-content">
                <h1 className="banner-system-name">源·語</h1>
                <p className="banner-system-desc">
                    《源·語》是一套為想學習泰雅族語的AI互動學習平台，
                    涵蓋影像辨識、詞彙遊戲及測驗學習等功能，
                    是教師尋找教學資源、學生自主學習的選擇之一！
                </p>
                <button className="banner-learn-more-btn">了解更多</button>
            </div>

            {/* <SysIntroduction /> */}
            <FunctionBtn />
            <Calendar examInfo={examInfo} />
            <News withImage={newsWithImage} withoutImage={newsWithoutImage} />
        </div>
    );
};
export default App;