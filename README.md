# 📌 專案安裝與執行指南

## 🚀 安裝專案相關套件
### 🔹 前端（React）
```sh
cd <你的專案路徑>/my-react-app/my-react-app/
npm install
```
### 🔹 後端（Django）
```sh
cd <你的專案路徑>/my-react-app/my-react-app/
pip install -r requirements.txt
```
## 🔐 取消推送 ```.env``` 金鑰

如果已將 ```.env``` 檔案加入 Git，請執行以下指令來移除：
```sh
cd <你的專案路徑>/my-react-app/my-react-app/
git rm --cached .env
```
## 🖥️ 啟動專案
### 🔹 後端（Django）
```sh
cd <你的專案路徑>/my-react-app/my-react-app/backend
python manage.py runserver
```
### 🔹 後端（FastAPI）
```sh
cd <你的專案路徑>/my-react-app/my-react-app/backend
uvicorn crawler.views:app --reload
```
### 🔹 前端（React + Vite）
```sh
cd <你的專案路徑>/my-react-app/my-react-app/
npm run dev
```
