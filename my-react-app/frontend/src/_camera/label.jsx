import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { Container, Button, Row, Col, Card } from "react-bootstrap";
import pexelsPhoto from "../../static/assets/pexels-photo.webp";

const App = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const image = location.state?.image;
    const file = location.state?.file;
    const [labels, setLabels] = useState([]);
    const [selectedLabels, setSelectedLabels] = useState(new Set());
    const [error, setError] = useState(false);
    const [useMockData, setUseMockData] = useState(false);
    const [annotatedImage, setAnnotatedImage] = useState(null);
    const [loading, setLoading] = useState(false); 
    useEffect(() => {
        if (!file) {
            console.error("未成功上傳圖片，將返回頁面");
            navigate("/camera");
            return;
        }

        setLoading(true); 

        if (useMockData) {
            const mockLabels = [
                { description: "花", score: 0.95 },
                { description: "男人", score: 0.85 },
                { description: "水", score: 0.90 },
                { description: "魚", score: 0.90 },
                { description: "睡覺", score: 0.90 },
                { description: "水果", score: 0.90 }
            ];
            setLabels(mockLabels);
            setLoading(false); 
        } else {
            const formData = new FormData();
            formData.append("file", file);

            axios.post(import.meta.env.VITE_API_VISION_URL, formData, {
                headers: {
                    "Content-Type": "multipart/form-data",
                },
            })
                .then((response) => {
                    if (response.data.error) {
                        setError(true);
                    } else {
                        setLabels(response.data.labels || []);
                        setAnnotatedImage(response.data.annotated_image || null);
                    }
                })
                .catch((error) => {
                    console.error("API 錯誤:", error);
                    if (error.response) {
                        console.log("📄 錯誤狀態碼:", error.response.status);
                        console.log("📄 錯誤訊息:", error.response.data);
                    } else {
                        console.log("❌ 無法連線到伺服器");
                    }
                    setError(true);
                })
                .finally(() => {
                    setLoading(false); // 無論成功或失敗都關閉 loading
                });
        }
    }, [file, navigate]);

    const toggleLabelSelection = (label) => {
        setSelectedLabels((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(label)) {
                newSet.delete(label);
            } else {
                newSet.add(label);
            }
            return newSet;
        });
    };

    return (
        <div
            className="d-flex justify-content-center align-items-center min-vh-100"
            style={{
                backgroundImage: `url(${pexelsPhoto})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
            }}
        >
            <Container
                className="p-4 rounded-2 shadow-lg"
                style={{ backgroundColor: "white", maxWidth: "900px", width: "90%" }}
            >
                <Row className="g-4">
                    <Col xs={12} md={6} className="d-flex justify-content-center align-items-center">
                        <div
                            className="d-flex align-items-center justify-content-center border rounded-3 border-3"
                            style={{
                                width: "500px",
                                height: "500px",
                                backgroundColor: "white",
                                borderRadius: "20px",
                            }}
                        >
                            {loading ? (
                                <div className="text-center">
                                    <div className="spinner-border text-primary" role="status"></div>
                                    <div className="mt-3 fw-bold">正在辨識中，請稍候...</div>
                                </div>
                            ) : error ? (
                                <h4 className="text-danger">辨識失敗</h4>
                            ) : annotatedImage ? (
                                <img
                                    src={annotatedImage}
                                    alt="辨識圖片"
                                    className="img-fluid rounded shadow"
                                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                                />
                            ) : image ? (
                                <img
                                    src={image}
                                    alt="上傳圖片"
                                    className="img-fluid rounded shadow"
                                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                                />
                            ) : null}
                        </div>
                    </Col>

                    <Col xs={12} md={6} className="d-flex flex-column align-items-center">
                        <h3 className="fw-bolder">
                            <svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" fill="currentColor" className="bi bi-check2-circle" viewBox="0 0 16 16">
                                <path d="M2.5 8a5.5 5.5 0 0 1 8.25-4.764.5.5 0 0 0 .5-.866A6.5 6.5 0 1 0 14.5 8a.5.5 0 0 0-1 0 5.5 5.5 0 1 1-11 0" />
                                <path d="M15.354 3.354a.5.5 0 0 0-.708-.708L8 9.293 5.354 6.646a.5.5 0 1 0-.708.708l3 3a.5.5 0 0 0 .708 0z" />
                            </svg>
                            &nbsp;選擇欲查看之單詞
                        </h3>
                        <h6 className="fw-bolder">
                            可複選，您已選擇{" "}
                            <span className="text-danger">{selectedLabels.size}</span> 個
                        </h6>
                        {loading && (
                            <div className="text-center my-2">
                                <div className="spinner-border text-primary" role="status" style={{ width: "1.5rem", height: "1.5rem" }}></div>
                                <div className="mt-1 text-secondary">載入中...</div>
                            </div>
                            )}

                        {error ? (
                            <h4 className="text-danger fw-bold">辨識失敗</h4>
                        ) : (
                            <div
                                className="w-100 d-flex flex-column align-items-center"
                                style={{ maxHeight: "300px", overflowY: "auto" }}
                            >
                                {labels.map((label, index) => (
                                    <Card
                                        key={index}
                                        className={`shadow-sm p-2 mb-2 w-100 ${selectedLabels.has(label.description) ? "border-primary" : ""}`}
                                        onClick={() => toggleLabelSelection(label.description)}
                                        style={{
                                            cursor: "pointer",
                                            transition: "0.3s",
                                            maxWidth: "250px",
                                        }}
                                    >
                                        <Card.Body className="d-flex justify-content-between align-items-center">
                                            <span className="fw-bold">{label.description}</span>
                                            <span className="text-muted">
                                                {(label.score * 100).toFixed(2)}%
                                            </span>
                                        </Card.Body>
                                    </Card>
                                ))}
                            </div>
                        )}

                        <div className="mt-4 d-flex gap-2">
                            <Button
                                className="mt-3"
                                variant="primary"
                                disabled={selectedLabels.size === 0}
                                onClick={() =>
                                    navigate("/camera/result", {
                                        state: { selectedWords: Array.from(selectedLabels) },
                                    })
                                }
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" className="bi bi-check2" viewBox="0 0 16 16">
                                    <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0" />
                                </svg>
                                &nbsp; 確認
                            </Button>
                            <Button className="mt-3" variant="secondary" onClick={() => navigate("/camera")}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-arrow-return-left" viewBox="0 0 16 16">
                                    <path fillRule="evenodd" d="M14.5 1.5a.5.5 0 0 1 .5.5v4.8a2.5 2.5 0 0 1-2.5 2.5H2.707l3.347 3.346a.5.5 0 0 1-.708.708l-4.2-4.2a.5.5 0 0 1 0-.708l4-4a.5.5 0 1 1 .708.708L2.707 8.3H12.5A1.5 1.5 0 0 0 14 6.8V2a.5.5 0 0 1 .5-.5" />
                                </svg>
                                &nbsp; 返回
                            </Button>
                        </div>

                        <br />
                        <h6 className="fw-bolder text-danger">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-exclamation-circle" viewBox="0 0 16 16">
                                <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16" />
                                <path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0M7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0z" />
                            </svg>
                            &nbsp;注意，確認後將無法回到此頁面
                        </h6>
                    </Col>
                </Row>
            </Container>
        </div>
    );
};

export default App;
