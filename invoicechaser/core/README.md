# InvoiceChaser — Core Dunning Engine (MVP slice)

הליבה הרצה של InvoiceChaser: המנוע שמחליט **מה לשלוח, מתי, ובאיזו רמת-נחרצות** לכל
חשבונית-פתוחה, ומנסח תזכורת מותאמת — עם guardrails לבטיחות-טון. זהו הבידול המרכזי
של המוצר (ראו [`../docs/05-ai-dunning-engine.md`](../docs/05-ai-dunning-engine.md)).

**אפס תלויות. רץ עם Node בלבד — בלי `npm install`.**

## הרצה

```bash
cd invoicechaser/core

# הדגמה על חשבוניות לדוגמה (תוכנית גבייה מלאה + תזכורות מנוסחות)
node src/cli.mjs samples/invoices.csv --today=2026-05-31 --mode=auto

# בדיקות
node test/run-tests.mjs
```

`--mode=approval` (ברירת-המחדל) = הכל ממתין לאישורך לפני שליחה. `--mode=auto` =
שולח אוטומטית, אבל **הודעה אחרונה (urgency 4) תמיד דורשת אישור-אדם**.

## מה יש כאן (מיפוי לאיפיון)

| קובץ | תפקיד | פרק באיפיון |
|------|--------|--------------|
| `src/domain.mjs` | מודל-נתונים + עזרי-חישוב (DSO, כסף, לינק-תשלום) | docs/09 §9.4 |
| `src/cadence.mjs` | Cadence Engine — מחליט פעולה הבאה / רצף מתוכנן | docs/05 §5.1, docs/04 §4.2 |
| `src/generator.mjs` | ניסוח תזכורת מותאמת (he/en, לפי נחרצות) | docs/05 §5.2 |
| `src/guardrails.mjs` | בטיחות-טון: חסימת איומים, תקרת-נחרצות | docs/05 §5.4 |
| `src/ai-adapter.mjs` | תפר ל-LLM (Claude) עם fallback בטוח לתבנית | docs/05 §5.6, docs/09 §9.6 |
| `src/csv.mjs` | ייבוא CSV (אפס-תלויות) | docs/04 §4.1 |
| `src/cli.mjs` | הדגמה רצה מקצה-לקצה | — |

## עקרונות שכבר ממומשים
- **הסלמה הדרגתית** — ידידותי → נחרץ, לפי ימי-האיחור.
- **בטיחות-טון** — אף פעם לא איום/שפה משפטית; final notice דורש אישור-אדם.
- **עצירה אוטומטית** — חשבונית `paid`/`disputed` לא נרדפת.
- **רב-לשוני** — עברית/אנגלית לפי הלקוח.
- **LLM-ready** — הגדר `ANTHROPIC_API_KEY` וחבר את `draftWithLLM` ב-`ai-adapter.mjs`;
  ה-guardrails נאכפים על פלט-ה-LLM, ויש fallback אוטומטי לתבנית.

## הצעד הבא (לא בליבה הזו)
- מעטפת web (Next.js) + DB (Postgres) לפי [`../docs/09-architecture.md`](../docs/09-architecture.md).
- שליחת-אימייל אמיתית (Resend/Postmark) + Stripe Payment Links + webhooks.
- אינטגרציית QuickBooks/Xero.
- **הערה:** סיכום ה"סך באיחור" ב-CLI מסכם מטבעות יחד לצורך הדגמה; ריבוי-מטבעות
  אמיתי הוא V1 (docs/04 §4.4).
