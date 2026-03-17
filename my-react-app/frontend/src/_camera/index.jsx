import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import { Button, Container, Row, Col } from "react-bootstrap";
import pexelsPhoto from '../../static/assets/pexels-photo.webp';

const App = () => {
    const [image, setImage] = useState(null);
    const [file, setFile] = useState(null);
    const [inputKey, setInputKey] = useState(Date.now());
    const fileInputRef = useRef(null); 
    const [fileName, setFileName] = useState("請選擇圖片");
    const navigate = useNavigate();

    const handleImageChange = (event) => {
        const newFile = event.target.files.length > 0 ? event.target.files[0] : null; 
        if (newFile==null) {
            setFileName(file.name); 
        }
        if (newFile) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setImage(reader.result);
            };
            reader.readAsDataURL(newFile);           
            setFile(newFile);
            setFileName(newFile.name); 
                    
        }
    };
    
    
    

   
    const handleCancel = () => {
        setImage(null);
        setFile(null);
        setInputKey(Date.now());
        setFileName("請選擇圖片"); 
    };

  
    const handleSubmit = () => {
        if (file) {
            const formData = new FormData();
            formData.append("image", file);

            navigate("/camera/label", { state: { image: image, file: file } });
        }
    };


   
    const handlePreviewClick = () => {
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    return (
        <div
            className="d-flex justify-content-center align-items-center"
            style={{
                backgroundImage:`url(${pexelsPhoto})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                minHeight:"calc(100vh - 70px)"
            }}
        >
            <Container
                className="p-4 rounded-2 shadow-lg"
                style={{
                    backgroundColor: "white",
                    maxWidth: "900px",
                    width: "90%",
                    boxShadow: "0 4px 10px rgba(0, 0, 0, 0.1)",
                }}
            >
                <Row className="g-4">
                   
                <Col xs={12} md={6} className="d-flex flex-column justify-content-center">
                        <div className="text-center">
                            <h3 className="fw-bolder text-secondary">影像變單字</h3>
                            <h3 className="fw-bolder text-secondary">學習更有趣</h3>
                            <br />
                            <h1 className="display-6 fw-bolder">打造專屬你的</h1>
                            <h1 className="display-5 fw-bolder text-danger">《ATAYAL單字卡》</h1>
                            <br />
                            <br />
                            <br />
                        </div>

                        <input
                            key={inputKey}
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={handleImageChange}
                            ref={fileInputRef}
                            style={{ display: "none" }}
                        />
                        <div className="mt-4 d-flex gap-2" style={{ alignItems: 'center,flex-start' }}>
                            &nbsp; 
                            &nbsp; 
                            &nbsp; 
                            <button className="btn btn-outline-secondary" onClick={handlePreviewClick}>
                                選擇圖片
                            </button>
                            <div className="center" style={{ display: 'flex', alignItems: 'center' }}>
                                <h6
                                    style={{
                                        width: '150px',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        marginBottom: 0,
                                    }}
                                >
                                    &nbsp;{fileName}
                                </h6>
                            </div>
                        </div>

                        
                        <div className="mt-4 d-flex gap-2" style={{ alignItems: 'flex-start' }}>
                            &nbsp; 
                            &nbsp; 
                            &nbsp; 
                            <Button onClick={handleSubmit} variant="primary" disabled={!image} style={{ display: 'flex', alignItems: 'center', justifyContent: "center" }}>                               
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-upload" viewBox="0 0 16 16"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5"/><path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708z"/>
                                </svg>
                                &nbsp; 提交
                            </Button>
                            <Button onClick={handleCancel} variant="danger" disabled={!image} style={{ display: 'flex', alignItems: 'center', justifyContent: "center" }}>                              
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-x-lg" viewBox="0 0 16 16"><path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/>
                                </svg>
                                &nbsp; 取消選擇
                            </Button>
                        </div>
                    </Col>

                   
                    <Col xs={12} md={6} className="d-flex justify-content-center align-items-center">
                        <div
                            className="d-flex align-items-center justify-content-center border rounded-3 border-3"
                            style={{
                                width: "500px",
                                height: "500px",
                                backgroundColor: "white",
                                cursor: "pointer",
                                borderRadius: "20px",                          
                            }}
                            onClick={handlePreviewClick} 
                        >
                            {image ? (
                                <img
                                    src={image}
                                    alt="預覽圖片"
                                    style={{
                                        maxWidth: "100%",
                                        maxHeight: "100%",
                                        objectFit: "contain",
                                    }}
                                />
                            ) : (
                                <div className="center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                                <div className="mt-4 d-flex gap-1" style={{ justifyContent: 'center' }}>
                                    &nbsp; 
                                    &nbsp; 
                                    <svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" fill="#7B7B7B" className="bi bi-image" viewBox="0 0 16 16">
                                    <path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0"/>
                                    <path d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1z"/>
                                    </svg>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" fill="#7B7B7B" className="bi bi-plus-lg" viewBox="0 0 16 16">
                                    <path fillRule="evenodd" d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2"/>
                                    </svg>
                                </div>
                                <br></br>
                                <h4 className="text-muted" style={{ marginTop: '10px',textColor:"#7B7B7B" }}>請選擇圖片</h4>
                                </div>
                            )}
                        </div>
                    </Col>
                </Row>
            </Container>
        </div>
    );
};

export default App;
