"""適性測驗（quiz）IRT 超參數的預設值（P4 review BE-29）。

原本這組數字在兩個完全獨立的執行期各自寫死一份、語意不同但數值理應永遠
一致：

- backend/fastAPI/routes/quiz/irt.py 的模組層級全域變數，是「後台
  IrtConfig 從未設定過、或後台暫時連不上時」的退回值；
- backend/adminapi/models/system_config.py 的 IrtConfig model 欄位
  default=，是資料庫這張單例表第一次建立時的初始值。

FastAPI 服務跟 Django 服務是兩個獨立部署、連的是不同資料庫（辭典 DB
跟後台 DB 是不同的 Postgres database，見 IrtConfig 的說明），沒辦法直接
共用同一個執行期物件，但兩邊「這套 IRT 公式在沒有人特別調整過時該用的
數字」只應該有一份來源，不該分別手動維護兩份、改一邊忘了改另一邊。

放在 backend/config/ 而不是 fastAPI 或 adminapi 任一邊底下——這個套件
（tribes.py／roles.py 等既有模組）本身只放純數字/字串常數，不 import
Django 或 FastAPI 的任何東西，兩邊都能安全 import 而不會把整個 Django
app registry 或 FastAPI 的相依套件一起拉進來。
"""

ALPHA0 = 1.0
BETA0 = 1.0
DEFAULT_GUESS = 0.25
TYPE_AQ_WORD_TRANSLATE = 1.2
TYPE_AQ_WORD_MATCH = 1.0
TYPE_AQ_SENTENCE_FILL = 0.9
TYPE_AQ_SENTENCE_ORDER = 1.1
LEARNING_RATE = 0.08
DQ_ALPHA = 0.45
DQ_BETA = 0.35
DQ_GAMMA = 0.20
BETA1 = 0.2
BETA2 = 0.2
BETA3 = 0.2
BETA4 = 0.2
BETA5 = 0.2
TOTAL_QUESTIONS = 10
