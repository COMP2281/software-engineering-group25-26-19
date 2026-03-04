## Scraper

#### NOTE TO SELF: GEMINI DOES NOT KNOW HOW TO USE PDF-PARSE

- [x] Make proper init script which can take in parameters like university/ies, specific course(s) (one or the other or none, input separated by commas). If no parameters then it scrapes absolutely everything. 
- [ ] Add database status saving through the new `Scrape` model. This should include the status (pending, running, failed, completed), any error messages if it failed, and the time it started and finished. This will allow us to show the status of scrapes on the dashboard and also help with debugging when something goes wrong.
- [ ] Add proper error handling (if not already there). I.e. skip a certain course/university if it is causing too many issues and fails to scrape multiple times. (Keep count of # of failed scrapes on each courseoption in the DB, do not scrape if count exceeds a certain threshold)
- [ ] Add checks for whether there is already a scrape running and if so, don't start a new one. Look in "Scrape" table, if most recent entry has status "pending" then don't start.
- [x] Fix a minor memory leak with puppeteer timeouts
- [ ] Improve overall parsing and semantics/keyword handling. List of keywords needs to be expanded, and scraper needs to handle full/part time fees independently (currently does not distinguish between the two as the standalone html scraper assumes it operates only on a singular courseoption)
- [ ] Improve recursive page parsing, script currently only searches one additional page for fees before giving up. For some unis, the UCAS url does not redirect to the course page (but does exist as a link on the provided page). This should be changed such that the script searches a few layers deep (2 or 3 max) and searches the top candidates instead of just 1 page (very conservatively as this could drastically increase runtime).

## Visualisation

- [ ] Create routes for fetching the 2 courses being compared
- [ ] Literally just display the data of the 2 courses side by side, no need for any fancy charts or anything. Just make sure all the data is there and looks nice. Maybe add some basic styling to make it look like a dashboard.