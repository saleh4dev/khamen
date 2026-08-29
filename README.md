# مين؟

لعبة جماعية فورية: ينشئ أحدكم غرفة، يشارك الباركود أو الرابط، ثم تبدأ جولات التخمين.

المستودع: [saleh4dev/khamen](https://github.com/saleh4dev/khamen)

## كيف تُلعب

1. المنشئ يفتح غرفة ويحدد عدد الجولات.
2. يظهر باركود ورابط للعب، ورابط لشاشة المتابعة.
3. في كل جولة يُختار لاعب سراً. تظهر له علامة صح خضراء وجملة مثل «أنت المقصود»، والبقية يرون علامة خطأ حمراء.
4. الجميع يختارون من القائمة من يتوقعون أن علامة الصح معه.
5. الإجابة الصحيحة تعطي نقاطاً، والأسرع يحصل على علاوة.
6. بعد كل جولة تظهر النقاط، وفي النهاية يظهر ترتيب الجميع.

لا تحتاج قاعدة بيانات. حالة الغرف تعيش في ذاكرة خادم Render طوال الجلسة.

## التشغيل المحلي

```bash
cd server && npm install && npm start
cd client && npm install && npm run dev
```

الواجهة: `http://localhost:5173`  
الخادم: `http://localhost:8787`

انسخ `client/.env.example` إلى `client/.env` إذا أردت توجيه الواجهة لخادم آخر.

## النشر

### Render (الخادم + اللعبة)

اترك **Root Directory** فارغاً، ثم:

```
Build Command: npm install --prefix server && npm install --prefix client && npm run build --prefix client
Start Command: npm start --prefix server
```

أضف متغير البيئة:

```
CORS_ORIGIN=https://saleh4dev.github.io,https://saleh4dev.github.io/khamen
```

### GitHub Pages (الواجهة)

1. من إعدادات المستودع فعّل GitHub Pages على **GitHub Actions**.
2. أضف متغيرات المستودع (Settings → Secrets and variables → Actions → Variables):

| المتغير | مثال |
|---|---|
| `VITE_SERVER_URL` | `https://who-game.onrender.com` |
| `VITE_BASE` | `/khamen/` |

3. ادفع على `main`. سيبني الإجراء الواجهة وينشرها.

بعد أول نشر، أعد بناء الواجهة إذا تغيّر عنوان Render.

## ملاحظات Render المجاني

الخدمة قد تنام بعد خمول. أول دخول بعد النوم يستغرق ثوانٍ حتى يستيقظ الخادم.
