# פריסה אונליין — InvoiceChaser

שלוש דרכים לקבל את הדשבורד אונליין. כל אחת דורשת **הגדרה חד-פעמית אחת** שלך
(אי-אפשר להפעיל אירוח/Pages דרך push בלבד).

---

## אופציה 1 — GitHub Pages (חינם, כבר מוגדר ב-workflow) ⭐

ה-workflow [`deploy-dashboard.yml`](../.github/workflows/deploy-dashboard.yml) בונה את
גרסת-הדפדפן ודוחף אותה לברנץ **`gh-pages`** בכל push (כך זה עוקף את חוקי
"environment protection" שחסמו את הפריסה מהברנץ הזה).

**הגדרה חד-פעמית (~30 שניות):**
1. ודא שה-workflow רץ פעם אחת (Actions → "Deploy InvoiceChaser dashboard" → Run,
   או כל push) — הוא יוצר את ברנץ `gh-pages`.
2. **Settings → Pages → Build and deployment → Source: "Deploy from a branch"**
   → Branch: **`gh-pages`** → תיקייה: **`/ (root)`** → **Save**.
3. תוך דקה: **https://gilhzn.github.io/ID_AA/**

(ריפו פרטי דורש מנוי בתשלום ל-Pages; ריפו ציבורי — חינם.)

---

## אופציה 2 — Render (Static Site, חינם, בלי כרטיס-אשראי)

הדשבורד הוא סטטי → אתר-סטטי ב-Render, בלי שרת ובלי build כבד.

1. [render.com](https://render.com) → **New → Blueprint**.
2. חבר את `gilhzn/id_aa`, ברנץ `claude/app-feature-spec-BUHh4`.
3. Render קורא את [`render.yaml`](../render.yaml) (בונה דרך `web/build-static.sh`)
   → **Apply**.
4. תוך 1–2 דקות: URL כמו `https://invoicechaser-dashboard.onrender.com`.

> שתי האופציות לעיל מגישות את **גרסת-הדפדפן** (אחסון localStorage, כולל כפתור
> "טען נתוני דמו"). אין שרת — מושלם לדמו ולשיתוף לינק.

---

## אופציה 3 — Docker (גרסת-שרת מלאה, לאירוח-עצמי / כל ענן)

לגרסה עם **שרת + שמירת-נתונים מתמשכת + ריבוי-לקוחות אמיתי**:

```bash
cd invoicechaser
docker compose up --build          # → http://localhost:3000
# או:
docker build -t invoicechaser . && docker run -p 3000:3000 -v "$PWD/_data:/data" invoicechaser
```
לפריסה בענן: דחוף את האימג' ל-Fly.io / Railway / Render (Web Service · Docker).
האימג' מבוסס `node:22-alpine`, מריץ `server.mjs` ב-multi-client על `/data`.

---

## הרצה מקומית מהירה (בלי שום הגדרה)
```bash
# גרסת-דפדפן סטטית:
sh invoicechaser/web/build-static.sh && cd invoicechaser/web/public && python3 -m http.server 8000
#   → http://localhost:8000

# או גרסת-השרת המלאה:
cd invoicechaser/core
node src/operator-cli.mjs import data/Demo.json samples/invoices.csv --name="Demo"
node src/server.mjs data           # → http://localhost:3000
```
