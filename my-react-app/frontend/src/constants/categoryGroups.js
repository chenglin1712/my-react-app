/**
 * 單詞分類表單一資料來源（33 個子分類、36 張分類圖）。
 *
 * 原本 _search/components/CategoryBar.jsx、_camera/result.jsx、_favorite/index.jsx
 * 三個檔案各自逐字重複維護同一份 categoryGroups 常數與全部圖片 import，
 * 新增/調整分類要改三個地方。這裡集中成唯一資料來源，其餘檔案改成從這裡 import。
 */

import pronoun from "../../static/assets/images/pronoun.webp";
import auxiliary from "../../static/assets/images/auxiliary.webp";
import particle from "../../static/assets/images/particle.webp";
import negative from "../../static/assets/images/negative.webp";
import question from "../../static/assets/images/question.webp";

// === 人與社會 ===
import person from "../../static/assets/images/person.webp";
import family from "../../static/assets/images/family.webp";
import culture from "../../static/assets/images/culture.webp";
import religion from "../../static/assets/images/religion.webp";
import clothing from "../../static/assets/images/clothing.webp";
import action from "../../static/assets/images/action.webp";

// === 自然與環境 ===
import animal from "../../static/assets/images/animal.webp";
import plant from "../../static/assets/images/plant.webp";
import mountain from "../../static/assets/images/mountain.webp";
import nature from "../../static/assets/images/nature.webp";
import hunting from "../../static/assets/images/hunting.webp";
import farming from "../../static/assets/images/farming.webp";

// === 物質與生活 ===
import building from "../../static/assets/images/building.webp";
import transport from "../../static/assets/images/transport.webp";
import object from "../../static/assets/images/object.webp";
import food from "../../static/assets/images/food.webp";
import diet from "../../static/assets/images/diet.webp";
import daily from "../../static/assets/images/daily.webp";

// === 身體與感官 ===
import body from "../../static/assets/images/body.webp";
import move from "../../static/assets/images/move.webp";
import sense from "../../static/assets/images/sense.webp";
import emotion from "../../static/assets/images/emotion.webp";
import sound from "../../static/assets/images/sound.webp";
import life from "../../static/assets/images/life.webp";

// === 抽象概念 ===
import time from "../../static/assets/images/time.webp";
import number from "../../static/assets/images/number.webp";
import space from "../../static/assets/images/space.webp";
import feature from "../../static/assets/images/feature.webp";
import color from "../../static/assets/images/color.webp";
import abstract from "../../static/assets/images/abstract.webp";

// === 其他 ===
import other from "../../static/assets/images/other.webp";

export const categoryGroups = {
  "語法與功能": [
    { name: "代名詞、指示詞", image: pronoun },
    { name: "助動詞", image: auxiliary },
    { name: "助詞或其他", image: particle },
    { name: "否定詞", image: negative },
    { name: "疑問詞", image: question },
  ],
  "人與社會": [
    { name: "人物、身分", image: person },
    { name: "親屬稱謂", image: family },
    { name: "傳統文化與習俗", image: culture },
    { name: "宗教", image: religion },
    { name: "織布服飾", image: clothing },
    { name: "行動", image: action },
  ],
  "自然與環境": [
    { name: "動物(含昆蟲)", image: animal },
    { name: "植物", image: plant },
    { name: "山川地理", image: mountain },
    { name: "自然景觀", image: nature },
    { name: "狩獵", image: hunting },
    { name: "農耕", image: farming },
  ],
  "物質與生活": [
    { name: "建築", image: building },
    { name: "交通", image: transport },
    { name: "物品(不含食品)", image: object },
    { name: "食物(非植物)", image: food },
    { name: "飲食", image: diet },
    { name: "生活作息", image: daily },
  ],
  "身體與感官": [
    { name: "身體部位", image: body },
    { name: "肢體動作", image: move },
    { name: "認知感官", image: sense },
    { name: "情緒思維", image: emotion },
    { name: "聲音", image: sound },
    { name: "生老病死傷", image: life },
  ],
  "抽象概念": [
    { name: "時間", image: time },
    { name: "數字計量", image: number },
    { name: "空間", image: space },
    { name: "特徵", image: feature },
    { name: "顏色", image: color },
    { name: "抽象名詞", image: abstract },
  ],
  "其他": [
    { name: "其他", image: other },
  ],
};
