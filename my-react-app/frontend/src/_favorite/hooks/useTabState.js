import { useState, useEffect } from 'react';

//狀態管理
export const useTabState = (favorites) => {
  const [tabStates, setTabStates] = useState({});

  useEffect(() => {
    // 用 setState 的 updater function 讀「當下」的 tabStates（prev），不透過外層
    // closure 讀 state：這樣 tabStates 本身就不需要出現在依賴陣列裡，也不用關掉
    // exhaustive-deps 檢查——本來就不能把 tabStates 放進依賴陣列，這個 effect
    // 自己會呼叫 setTabStates，放進去會變成無限迴圈。
    setTabStates(prev => {
      const newTabStates = {};
      favorites.forEach(fav => {
        newTabStates[fav.id] = prev[fav.id] || {
          inputValue: '',
          activeQuery: '',
          sortOrder: 'asc',
          filterLetter: '',
          frequencyFilter: ''
        };
      });
      return newTabStates;
    });
  }, [favorites]);

  const updateTabState = (tabId, key, value) => {
    setTabStates(prev => ({
      ...prev,
      [tabId]: {
        ...prev[tabId],
        [key]: value
      }
    }));
  };

  return [tabStates, updateTabState];
};
