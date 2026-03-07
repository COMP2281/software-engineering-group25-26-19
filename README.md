[![Review Assignment Due Date](https://classroom.github.com/assets/deadline-readme-button-22041afd0340ce965d47ae6ef1cefeee28c7c493a6346c4f15d667ab976d596c.svg)](https://classroom.github.com/a/B06_mcpV)

# DU SPIO Competitor Benchmarking - Documentation

Welcome to the technical documentation for the University Course & Fee Scraper application. This documentation is structured to help you understand the architecture, maintain the codebase, and extend its functionality.

## 📚 Documentation Structure

The documentation is split into three main layers:

1.  **[Frontend Documentation](docs/frontend.md)**
    *   Learn about the React application, component structure, and API integration.
2.  **[Database Documentation](docs/database.md)**
    *   Understand the Prisma schema, data models, and relationships.
3.  **Backend Documentation**
    *   **[Application & API](docs/backend/app.md)**: Details on the Express.js server, routing, and authentication.
    *   **[Scraper Engine](docs/backend/scraper.md)**: Deep dive into the scraping architecture, adapter pattern, and how to write new scrapers (using Edinburgh as an example).

## 🚀 Quick Start

### Prerequisites
- Node.js (v18+)
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
    - Create `.env` file in the `backend` directory based on `.env.example`.
4.  **Initialize Database**
    ```bash
    cd backend
    npx prisma generate
    npx prisma migrate dev
    ```
5.  **Run the App**
    - Backend: `npm run dev`
    - Frontend: `npm run dev`

## 🛠 Project Overview

This application is designed to scrape course information and tuition fees from various UK university websites. It provides a dashboard to view the scraped data, manage scraping tasks, and export data.

### Key Features
- **Automated Scraping**: Configurable scrapers for different university website structures.
- **Data Standardization**: Normalizes diverse fee structures into a common format.
- **Dashboard**: A user-friendly interface to trigger scrapes and view results.
- **Excel Export**: Download scraped data for analysis.

---