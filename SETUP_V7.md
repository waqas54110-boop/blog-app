# V7: Prediction League (setup guide)

Cricket matches par readers winner predict karte hain. Sahi prediction = 10 points. League table `/predictions` par.

## Deploy ke qadam (is tarteeb se)
1. **Database (deploy se PEHLE):** `migration_v7.sql` Neon SQL Editor mein paste karke Run karein. Dobara run karna safe hai. Do tables: `pred_matches`, `predictions`.
2. `git add -A && git commit -m "V7 prediction league" && git push` (Railway khud deploy karega).

Koi nayi npm package nahi.

## Istemal
- **Admin:** navbar mein 🎯 Predictions kholein, upar "Add match" form se teams + start time daalein.
- **Reader:** login karke team chunta hai; start time tak pick badal sakta hai. Start ke baad match lock.
- **Result:** match khatam hone par admin "X won / Draw" dabaye. Sahi predictors ko 10 points aur 🔔 notification milti hai.
  Result ek hi baar save hota hai (double points nahi milte).

## Check kaise karein
1. Admin se ek match banayein (start time thora aage), 2. dusre account se prediction lagayein,
3. admin se result daalein, 4. league table aur notification dekhein.
