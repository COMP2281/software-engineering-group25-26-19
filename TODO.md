## Backend

### Web Scraping

#### Language Requirements

- Look into IELTS requirements
- Most unis have the requirements listed on a separate page with different grade bands
- Then on the course pages themselves it just states the grade band for the language requirements
- So separate logic would have to be written for scraping the language requirements pages and linking them to the courses
- Probably makes sense to make a `LanguageRequirement` model in the database and link it to courses via a foreign key
- This model should hold the different grade bands and their requirements with a full breakdown per skill (reading, writing, speaking, listening)

#### Course Fees

- Easier than language requirements because these would always be listed on the actual course pages
- Just make a rule looking for the pound sign and grab the numbers that way
- Then figure out what to do with them 

#### Notes

- Have a look at https://www..../robots.txt and https://www..../sitemap.xml (may be different on some sites). Example: https://www.durham.ac.uk/sitemap-en.xml
- Could be helpful to automate grabbing relevant links from there maybe?? to not write exact custom rules for absolutely each course/uni/whatever
- Use https://aistudio.google.com (1 million context tokens) to just plug in the full sitemap or html to write the rules for parsing
- Look for libraries similar to python's BeautifulSoup in Typescript/Node.js. DO NOT write custom HTML parsing logic yourself, there are already well established libraries for this


### REST API

- Add all routes for all the behavioural requirements
- Whenever frontend pages are done, link it all up with fetch or axios on the frontend.


## Frontend

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