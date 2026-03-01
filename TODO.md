## Backend

### Web Scraping -- Sam & Omar

#### Course Fees

31/01/26 Omar update: remove deposity from list of words that we shouldnt scrape and make threshold 9000 instead of 1000

- Easier than language requirements because these would always be listed/linked on the actual course pages (but NOT always displayed on the course page itself)
- Just make a rule looking for the pound sign and grab the numbers that way, look for keywords (i.e: overseas, international, England, etc.), AVOID accommodation/other "trick" costs
- If home & international fees are not found, look for "fee" links and follow, repeat the lookup logic (will have to handle .pdf links separately)

#### Notes

- Have a look at https://www..../robots.txt and https://www..../sitemap.xml (may be different on some sites). Example: https://www.durham.ac.uk/sitemap-en.xml
- Could be helpful to automate grabbing relevant links from there maybe?? to not write exact custom rules for absolutely each course/uni/whatever
- Use https://aistudio.google.com (1 million context tokens) to just plug in the full sitemap or html to write the rules for parsing
- Look for libraries similar to python's BeautifulSoup in Typescript/Node.js. DO NOT write custom HTML parsing logic yourself, there are already well established libraries for this
- UCAS API does NOT provide some information in some cases, in which an HTML scraper will be needed instead
- Essentially, we can run the UCAS API first to scrape as much information as possible, then fill in the rest with the HTML scraper
- The HTML scraper will never be fully robust, so we may need a confidence score or some way to tell the user that the data may not be accurate
- For Scottish universities, there are 3 fee "bands": Scotland, UK, and International. May have to adjust the schema


### REST API

- Add all routes for all the behavioural requirements
- Whenever frontend pages are done, link it all up with fetch or axios on the frontend.


## Frontend -- Matteo & Callum

- Have a look at figma
- No need to go overboard with the styling
- You can even use bootstrap or tailwind or whatever for the styles
- Don't forget that AI can do styling very easily and without any hassle
- Just make sure that the structure of the code and the files is clean and easy to follow
- Also, make some kind of logic for mock data, so that it is easy to replace it with real API calls later on

### Course Lookup Page

- Follow behavioural requirements

### Dashboard Page

- Follow behavioural requirements
