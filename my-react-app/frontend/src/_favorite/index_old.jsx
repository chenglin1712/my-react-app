import React, { useState, useEffect } from 'react';
import {
  Container, ListGroup, Button, InputGroup, Form, Dropdown, Tabs, Tab
} from 'react-bootstrap';
import { useLocation } from 'react-router-dom';
import { FaHeart, FaRegHeart, FaPlayCircle } from 'react-icons/fa';
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../../firebase";
import { authChanges } from "../../src/userServives/userServive";
import PermissionProtect from "../userServives/permissionProtect";
import axios from 'axios';
import { Heart, Volume2, Star } from 'lucide-react';

const renderStars = (fre) => {
  if (!fre) return null;
  const starCount = (fre.match(/★/g) || []).length;
  const match = fre.match(/\((\d+)\)/);
  const count = match ? match[1] : '';
  return (
    <>
      {[...Array(starCount)].map((_, i) => (
        <span key={i} style={{ color: '#FFC107', fontSize: '1rem', marginRight: '1px' }}>⭐</span>
      ))}
      {count && <span style={{ marginLeft: '2px', color: '#666' }}>（{count}）</span>}
    </>
  );
};

const WordCard = ({ word, result, keyName, expandedWord, toggleExpand, toggleFavorite, playAudio, isFavorited }) => (
  <ListGroup.Item key={keyName} className="d-flex flex-column">
    <div className="d-flex justify-content-between align-items-center">
      <div onClick={() => toggleExpand(keyName)} style={{ cursor: 'pointer', flex: 1 }}>
        <h3 className="fw-bolder text-danger">
          {result.word_tayal || '無資料'}
          {result.word_audio && (
            <Button variant="link" onClick={(e) => { e.stopPropagation(); playAudio(result.word_audio); }}>
              <FaPlayCircle size={20} className="text-warning" />
            </Button>
          )}
        </h3>
        <h5 className="fw-bolder">{word}</h5>
      </div>
      <Button variant="link" onClick={() => toggleFavorite(result.word_tayal)}>
        {isFavorited ? <FaHeart color="red" /> : <FaRegHeart color="black" />}
      </Button>
    </div>
    {expandedWord === keyName && (
      <div className="mt-2 pt-2 border-top">
        <ListGroup variant="flush">
          <ListGroup.Item><strong>詞頻：</strong>{renderStars(result.word_fre)}</ListGroup.Item>
          <ListGroup.Item><strong>分類：</strong>{result.word_str || ''}</ListGroup.Item>
          {result.defins?.map((def, i) => (
            <ListGroup.Item key={i}>
              <h5 className="fw-bolder">{def.word_ch || ''}</h5>
              <h6><strong>分類：</strong>{def.word_cate || ''}</h6><br />
              {def.examples?.map((ex, ei) => {
                const hasText = ex.ex_tay?.trim() || ex.ex_ch?.trim();
                if (!hasText) return null;
                return (
                  <ListGroup.Item key={`${i}-${ei}`}>
                    <h6 className="fw-bolder text-danger">
                      {ex.ex_tay}
                      {ex.ex_tay_audio && (
                        <Button variant="link" onClick={() => playAudio(ex.ex_tay_audio)}>
                          <FaPlayCircle size={20} className="text-warning" />
                        </Button>
                      )}
                    </h6>
                    <h6 className="fw-bolder">{ex.ex_ch}</h6>
                  </ListGroup.Item>
                );
              })}
            </ListGroup.Item>
          ))}
        </ListGroup>
      </div>
    )}
  </ListGroup.Item>
);

const App = () => {
  const [user, setUser] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [activeTab, setActiveTab] = useState(1);
  const [allWords, setAllWords] = useState([]);
  const [expandedWord, setExpandedWord] = useState(null);
  const [audio, setAudio] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tabStates, setTabStates] = useState({});
  const location = useLocation();

  useEffect(() => {
    if (location.state?.tabId) {
      setActiveTab(location.state.tabId);
    }
  }, [location.state]);
  useEffect(() => {
    setLoading(true);
    axios.post('http://127.0.0.1:8001/dictionary/all/')
      .then(res => {
        setAllWords(Object.values(res.data.all_results).flat());
        setLoading(false);
      });

    const unsubscribe = authChanges((userData) => {
      if (userData) {
        setUser(userData);
        setFavorites(userData.firestoreData.favorites || []);

        const newTabStates = {};
        for (const fav of userData.firestoreData.favorites) {
          newTabStates[fav.id] = {
            inputValue: '',
            activeQuery: '',
            sortOrder: 'asc',
            filterLetter: '',
            frequencyFilter: ''
          };
        }
        setTabStates(newTabStates);
      }
    });

    return () => unsubscribe();
  }, []);

  const playAudio = (url) => {
    if (url) {
      if (audio) audio.pause();
      const newAudio = new Audio(url);
      newAudio.play();
      setAudio(newAudio);
    }
  };

  const toggleFavorite = async (wordTayal, categoryId) => {
    try {
      const updatedFavorites = favorites.map(fav => {
        if (fav.id !== categoryId) return fav;

        const exists = fav.content.includes(wordTayal);
        const newContent = exists
          ? fav.content.filter(w => w !== wordTayal)
          : [...fav.content, wordTayal];

        return { ...fav, content: newContent };
      });


      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, { favorites: updatedFavorites });


      setFavorites(updatedFavorites);
    } catch (err) {
      console.error("取消收藏失敗：", err);
    }
  };

  const alphabet = [...Array(26)].map((_, i) => String.fromCharCode(97 + i)).concat("'");
  const matchQuery = (wordObj, query) => {
    if (!query) return true;

    const tayal = wordObj.word_tayal || '';
    const ch = wordObj.word_ch || '';
    const defins = wordObj.defins || [];

    return (
      tayal.includes(query) ||
      ch.includes(query) ||
      defins.some(d => (d.word_ch || '').includes(query))
    );
  };
  const matchSearchCriteria = (wordObj, query) => {
    if (!query) return true;

    const lowerQuery = query.toLowerCase();
    const tayal = (wordObj.word_tayal || '').toLowerCase();
    const ch = (wordObj.word_ch || '').toLowerCase();
    const defins = wordObj.defins || [];

    return (
      tayal.includes(lowerQuery) ||
      ch.includes(lowerQuery) ||
      defins.some(def => (def.word_ch || '').toLowerCase().includes(lowerQuery))
    );
  };
  const filterAndSort = (contentIds, state) => {
    return allWords
      .filter(w => {
        const tayal = (w.word_tayal || '').toLowerCase();
        const matchId = contentIds.includes(w.word_tayal);

        const matchLetter = !state.filterLetter || tayal.startsWith(state.filterLetter);

        const starCount = (w.word_fre?.match(/★/g) || []).length;
        const matchFreq = !state.frequencyFilter || starCount === parseInt(state.frequencyFilter);

        const matchQuery = matchSearchCriteria(w, state.activeQuery);

        return matchId && matchLetter && matchFreq && matchQuery;
      })
      .sort((a, b) => {
        const aWord = (a.word_tayal || '').toLowerCase();
        const bWord = (b.word_tayal || '').toLowerCase();
        return state.sortOrder === 'asc' ? aWord.localeCompare(bWord) : bWord.localeCompare(aWord);
      });
  };


  // 等待資料跑的時間
  const [delayedCheck, setDelayedCheck] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDelayedCheck(true);
    }, 1000); // 1秒後開始檢查

    return () => clearTimeout(timer);
  }, []);

  if (!user && delayedCheck) return <PermissionProtect />;

  return (
    <Container className="p-4">
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 900,
          backgroundColor: 'white',
          paddingTop: '1rem',
          paddingBottom: '1rem',
          borderBottom: '1px solid #ccc'
        }}
      >
        <h2 className="fw-bolder d-flex align-items-center mb-3">
          <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" fill="currentColor" className="bi bi-heart" viewBox="0 0 16 16">
            <path d="M8 2.748L7.283 2.01C5.6.281 2.514.878 1.4 3.053c-.523 1.023-.641 2.5.314 3.905C2.634 8.313 4.548 10.13 8 12.343c3.452-2.213 5.365-4.03 6.286-5.385.955-1.405.838-2.882.314-3.905C13.486.878 10.4.28 8.717 2.01L8 2.748zM8 15C-7.333 4.868 3.279-3.04 7.824 1.143c.06.055.119.112.176.171.057-.059.116-.115.176-.17C12.72-3.042 23.333 4.867 8 15z" />
          </svg>&nbsp; 個人詞語庫
        </h2>

        <Tabs
          activeKey={activeTab}
          onSelect={(k) => setActiveTab(parseInt(k))}
          justify
          className="mb-3"
        >
          {favorites.map(tab => (
            <Tab key={tab.id} eventKey={tab.id} title={tab.title} />
          ))}
        </Tabs>

        {(() => {
          const tab = favorites.find(t => t.id === activeTab);
          const state = tabStates[activeTab] || {};

          if (!tab) return null;

          return (
            <>
              <InputGroup className="mb-3">
                <Form.Control
                  placeholder="請輸入查詢內容"
                  value={state.inputValue}
                  onChange={e => {
                    const newStates = { ...tabStates };
                    newStates[tab.id].inputValue = e.target.value;
                    setTabStates(newStates);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const newStates = { ...tabStates };
                      newStates[tab.id].activeQuery = newStates[tab.id].inputValue;
                      setTabStates(newStates);
                    }
                  }}
                />
                <Button
                  variant="danger"
                  onClick={() => {
                    const newStates = { ...tabStates };
                    newStates[tab.id].activeQuery = newStates[tab.id].inputValue;
                    setTabStates(newStates);
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="currentColor" className="bi bi-search" viewBox="0 0 16 16">
                    <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0" />
                  </svg>
                </Button>
              </InputGroup>

              <div className="d-flex mb-3 align-items-center">
                <Button
                  variant="outline-dark"
                  className="me-3"
                  onClick={() => {
                    const newStates = { ...tabStates };
                    newStates[tab.id].sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
                    setTabStates(newStates);
                  }}
                >
                  排序：{state.sortOrder === 'asc' ? 'A→Z' : 'Z→A'}
                </Button>

                <Dropdown onSelect={(val) => {
                  const newStates = { ...tabStates };
                  newStates[tab.id].filterLetter = val;
                  setTabStates(newStates);
                }}>
                  <Dropdown.Toggle variant="outline-dark">
                    開頭：{state.filterLetter || '全部'}
                  </Dropdown.Toggle>
                  <Dropdown.Menu>
                    <Dropdown.Item eventKey="">全部</Dropdown.Item>
                    {alphabet.map(l => (
                      <Dropdown.Item key={l} eventKey={l}>{l}</Dropdown.Item>
                    ))}
                  </Dropdown.Menu>
                </Dropdown>

                <Dropdown className="ms-3" onSelect={(val) => {
                  const newStates = { ...tabStates };
                  newStates[tab.id].frequencyFilter = val;
                  setTabStates(newStates);
                }}>
                  <Dropdown.Toggle variant="outline-dark">
                    詞頻：{state.frequencyFilter ? `${state.frequencyFilter}★` : '全部'}
                  </Dropdown.Toggle>
                  <Dropdown.Menu>
                    <Dropdown.Item eventKey="">全部</Dropdown.Item>
                    {[4, 3, 2, 1].map(n => (
                      <Dropdown.Item key={n} eventKey={n}>{`${n}★`}</Dropdown.Item>
                    ))}
                  </Dropdown.Menu>
                </Dropdown>
              </div>
            </>
          );
        })()}
      </div>
      <ListGroup>
        {(() => {
          const tab = favorites.find(t => t.id === activeTab);
          const state = tabStates[activeTab] || {};
          if (!tab) return null;

          return filterAndSort(tab.content, state).map((wordData, idx) => (
            <WordCard
              key={wordData.word_tayal + idx}
              keyName={wordData.word_tayal + idx}
              word={wordData.word_ch || wordData.defins?.[0]?.word_ch || ''}
              result={wordData}
              expandedWord={expandedWord}
              toggleExpand={setExpandedWord}
              toggleFavorite={() => toggleFavorite(wordData.word_tayal, tab.id)}
              playAudio={playAudio}
              isFavorited={tab.content.includes(wordData.word_tayal)}
            />
          ));
        })()}
      </ListGroup>

    </Container>
  );
};

export default App;
