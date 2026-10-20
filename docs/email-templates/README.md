# תבניות מייל ל-Supabase

שתי תבניות בעברית, בעיצוב השחור-סגול של FCN. הן מעוצבות עם CSS inline בלבד, כדי שייראו טוב גם בג'ימייל וגם בטלפון.

## איפה מדביקים

ב-Supabase: **Authentication → Emails → Templates** (בגרסאות ישנות של הממשק: **Authentication → Email Templates**).

| קובץ | לשונית ב-Supabase | נושא (Subject) |
| --- | --- | --- |
| `invite.html` | **Invite user** | `הוזמנת לענן המשפחתי FCN` |
| `reset-password.html` | **Reset password** | `איפוס סיסמה ל-FCN` |

לכל תבנית:

1. פותחים את הלשונית המתאימה.
2. מעתיקים את הנושא מהטבלה לשדה **Subject heading**.
3. מוחקים את כל התוכן שבשדה **Message body**, ומדביקים במקומו את כל תוכן הקובץ.
4. לוחצים **Save changes**.

## חשוב

- הקישורים בתבניות בנויים מ-`{{ .SiteURL }}`, ולכן ב-**Authentication → URL Configuration** השדה **Site URL** חייב להיות `https://fcn-fcn4.vercel.app`.
- אל תשנו את החלק `token_hash={{ .TokenHash }}&type=...&next=/set-password` בקישור. האפליקציה מצפה לו בדיוק כך (`/auth/confirm`).
