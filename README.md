[![Review Assignment Due Date](https://classroom.github.com/assets/deadline-readme-button-22041afd0340ce965d47ae6ef1cefeee28c7c493a6346c4f15d667ab976d596c.svg)](https://classroom.github.com/a/B06_mcpV)

# DU SPIO Competitor Benchmarking - Documentation

Welcome to the technical documentation for the University Course & Fee Scraper application. This documentation is structured to help you understand the architecture, maintain the codebase, and extend its functionality.

**Product handover:** The completed handover confirmation document is available here: [Product_Handover_Confirmation.pdf](./Product_Handover_Confirmation.pdf).

## 📚 Documentation Structure

The documentation is split into three main layers:

1.  **[Frontend Documentation](docs/frontend.md)**
    *   Learn about the React application, component structure, and API integration.
2.  **[Database Documentation](docs/database.md)**
    *   Understand the Prisma schema, data models, and relationships.
3.  **Backend Documentation**
    *   **[Application & API](docs/backend/app.md)**: Details on the Express.js server, routing, and authentication.
    *   **[Scraper Engine](docs/backend/scraper.md)**: How UCAS import, Prisma rows, `manager.ts`, `config.ts`, and custom adapters work together.

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- PostgreSQL
- npm or yarn

### Installation

1.  **Clone the repository**
2.  **Install dependencies** for both backend and frontend:
    ```bash
    cd backend && npm install
    cd ../frontend && npm install
    ```
3.  **Setup Environment Variables**
    - Create a `.env` file in the `backend` directory based on `.env.example`.
    - At minimum, it should contain:
      ```env
      DATABASE_URL=postgresql://user:password@localhost:5432/courses_dev
      PORT=5001
      ```
4.  **Initialize Database**
    ```bash
    cd backend
    npx prisma generate
    npx prisma migrate deploy
    ```

    For a clean local reset, use:
    ```bash
    cd backend
    npx prisma migrate reset --force
    ```

    This deletes local database data and reapplies all migrations.

5.  **Import UCAS Data**
    ```bash
    cd backend
    npx ts-node src/ucas_job.ts
    ```

    This imports universities, courses, course URLs, and course options from UCAS. The scraper works from these database rows and fills missing fee values.

6.  **Run the App**

    To start backend and frontend together:
    ```bash
    cd backend
    npm run dev
    ```

    Or run them separately:
    ```bash
    # Terminal 1
    cd backend
    npm run dev:server

    # Terminal 2
    cd frontend
    npm run dev
    ```

### Running The Scraper

Scrape missing fees for one university:
```bash
cd backend
npx ts-node src/scrapers/manager.ts --universityIds="UNIVERSITY_ID"
```

Scrape one course for one university:
```bash
cd backend
npx ts-node src/scrapers/manager.ts --universityIds="UNIVERSITY_ID" --q="Course Name"
```

View the database and find university IDs:
```bash
cd backend
npx prisma studio
```

Scraper logs are written to `backend/logs/scrape-*.log`.

For the full scraper workflow, see [Scraper Engine](docs/backend/scraper.md).

## 🛠 Project Overview

This application is designed to scrape course information and tuition fees from various UK university websites. It provides a dashboard to view the scraped data, manage scraping tasks, and export data.

### Key Features
- **Automated Scraping**: Configurable scrapers for different university website structures.
- **Data Standardization**: Normalizes diverse fee structures into a common format.
- **Dashboard**: A user-friendly interface to trigger scrapes and view results.
- **Excel Export**: Download scraped data for analysis.

---
