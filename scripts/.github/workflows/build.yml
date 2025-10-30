name: Build VVX Pages

on:
  schedule:
    - cron: "*/30 * * * *"   # every 30 minutes
  workflow_dispatch:         # allow manual runs from the Actions tab

permissions:
  contents: write            # required so the workflow can commit the generated files

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Build pages
        run: node scripts/build-pages.js
        env:
          WEATHERAPI_KEY: ${{ secrets.WEATHERAPI_KEY }}
          STORMGLASS_KEY: ${{ secrets/STORMGLASS_KEY }}

      - name: Commit updates
        run: |
          git config user.name "GitHub Actions"
          git config user.email "actions@users.noreply.github.com"
          git add page1-weather.html page2-tides.html page3-moon.html page4-sun.html
          git commit -m "Auto-build VVX pages" || echo "No changes to commit"
          git push
