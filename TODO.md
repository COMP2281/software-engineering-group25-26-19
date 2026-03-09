## Scraper

- [ ] Add database status saving through the new `Scrape` model. This should include the status (pending, running, failed, completed), any error messages if it failed, and the time it started and finished. This will allow us to show the status of scrapes on the dashboard and also help with debugging when something goes wrong.
- [ ] Add proper error handling (if not already there). I.e. skip a certain course/university if it is causing too many issues and fails to scrape multiple times. (Keep count of # of failed scrapes on each courseoption in the DB, do not scrape if count exceeds a certain threshold)
- [ ] Add checks for whether there is already a scrape running and if so, don't start a new one. Look in "Scrape" table, if most recent entry has status "pending" then don't start.

## Visualisation

- [ ] Create routes for fetching the 2 courses being compared
- [ ] Literally just display the data of the 2 courses side by side, no need for any fancy charts or anything. Just make sure all the data is there and looks nice. Maybe add some basic styling to make it look like a dashboard.
