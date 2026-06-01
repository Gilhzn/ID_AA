# פריסה אונליין — InvoiceChaser

שלוש דרכים לקבל את הדשבורד אונליין. כולן מהריפו הזה.

---

## אופציה 1 — Render (הכי מהיר לאונליין, ללא Docker, חינם) ⭐

הדשבורד הוא Node אפס-תלויות — Render בונה ומריץ אותו ישירות.

1. היכנס ל-[render.com](https://render.com) → **New → Blueprint**.
2. חבר את הריפו `gilhzn/id_aa` ובחר את הברנץ `claude/app-feature-spec-BUHh4`.
3. Render יקרא את [`render.yaml`](../render.yaml) שבשורש → **Apply**.
4. תוך 1–2 דקות תקבל URL ציבורי כמו `https://invoicechaser-dashboard.onrender.com`.

(הדמו נזרע אוטומטית עם סוכנות "Studio Pixel (Demo)" + 7 חשבוניות.)

---

## אופציה 2 — Docker (להרצה על המחשב שלך או על כל הוסט)

```bash
cd invoicechaser
docker compose up --build          # → http://localhost:3000
# או ידנית:
docker build -t invoicechaser .
docker run -p 3000:3000 -v "$PWD/_data:/data" invoicechaser
```
האימג' מבוסס `node:22-alpine`, מריץ את שרת-הדשבורד ב-multi-client, ושומר
workspaces ב-volume `/data`. לפריסה על Fly.io / Railway / כל ענן — דחוף את
האימג' הזה.

> הערה: ה-image נבדק לוגית; הבנייה דורשת גישה ל-Docker Hub (לא הייתה זמינה
> בסביבת-הפיתוח האוטומטית, ולכן נבנה אצלך/אצל ההוסט).

---

## אופציה 3 — GitHub Pages (גרסת-דפדפן סטטית, חינם)

גרסה שרצה כולה בדפדפן (אחסון localStorage). ה-workflow
[`deploy-dashboard.yml`](../.github/workflows/deploy-dashboard.yml) מפרסם אותה.

הפעלה חד-פעמית בריפו:
1. **Settings → Pages → Source: GitHub Actions**.
2. **Settings → Environments → github-pages → Deployment branches** → הוסף את
   הברנץ הנוכחי (או "All branches").
3. **Actions → Deploy InvoiceChaser dashboard → Run**.
4. הלינק: `https://gilhzn.github.io/id_aa/`.

(ריפו פרטי דורש מנוי בתשלום ל-Pages; ריפו ציבורי — חינם.)

---

## הרצה מקומית מהירה (בלי Docker, בלי שום הגדרה)
```bash
cd invoicechaser/core
node src/operator-cli.mjs import data/Demo.json samples/invoices.csv --name="Demo"
node src/server.mjs data            # → http://localhost:3000
```
