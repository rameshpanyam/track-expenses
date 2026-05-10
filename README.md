# Expense Tracker PWA

A mobile-first Progressive Web App for tracking monthly expenses by category. Works offline. Installable on iPhone via Safari "Add to Home Screen". Zero backend, zero cost.

## Categories
Food · Grocery · Market · Medicine · Petrol · Recharge · Water · Gifts · Other

## Deploy to GitHub Pages (free hosting)

```bash
cd /Users/p0r07an/Documents/expense-tracker-pwa
git init
git add .
git commit -m "Initial PWA"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/expense-tracker.git
git push -u origin main
```

Then in your GitHub repo → **Settings → Pages → Source: main / (root)** → Save.

Your app will be live at: `https://YOUR_USERNAME.github.io/expense-tracker/`

## Install on iPhone

1. Open the link in **Safari** on your iPhone
2. Tap the **Share** button (square with arrow)
3. Tap **"Add to Home Screen"**
4. Name it "Expenses" → tap **Add**

Done — it appears as an app icon, opens full-screen with no browser bar, works offline.

## Generate Icons

Open `generate-icons.html` in any browser, download `icon-192.png` and `icon-512.png`, and place them in the `icons/` folder before deploying.
