# Run: just demo-record
# Prerequisites: Chrona server running on localhost:3101

demo-record: clean-videos _playwright _convert-gifs
	@echo ""
	@echo "Done → docs/assets/demo-plan.gif  +  docs/assets/demo-assistant.gif"

# Remove old artifacts and GIFs
clean-videos:
	rm -rf artifacts/demo/playwright/
	rm -f docs/assets/demo-plan.gif docs/assets/demo-assistant.gif

# Run the Playwright recordings (server must be running on :3101)
_playwright:
	bunx playwright test --config=playwright.record.config.ts

# Convert recorded videos to GIFs
_convert-gifs:
	@sh scripts/demo/convert-record-gifs.sh

# Clean everything produced by this flow
clean:
	rm -rf artifacts/demo/playwright/

# Run both demos and open report
demo-debug: clean-videos
	bunx playwright test --config=playwright.record.config.ts --debug
