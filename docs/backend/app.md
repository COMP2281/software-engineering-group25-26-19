# Backend Application Documentation (Layer 3 - Core)

This document provides documentation for the core backend application, including the Express.js server, API routing, and middleware.

## 🏗 Architecture

The backend is built as a RESTful API using Express.js and TypeScript. It relies on a layered architecture:

- **Entry Point**: `src/index.ts` (Server configuration)
- **Router**: `src/routes/` (URL endpoint definitions)
- **Controllers**: Inline request handlers within routes (logic)
- **Services**: `src/services.ts` (Reusable business logic)
- **Database Access**: via `prisma` client (`src/db.ts`)

## 🚀 Server Setup (`src/index.ts`)

The server initializes:
1.  **Environment Variables**: Loaded via `dotenv`.
2.  **Middleware**:
    - `express.json()`: Parse JSON request bodies.
    - `express-session`: Session management with PostgreSQL store (`@quixo3/prisma-session-store`).
3.  **Routes**: Mounted at `/api`.
4.  **Static Files**: Serves the frontend build in production mode.

## 🔐 Authentication & Security

- **Library**: `passport.js` (Local Strategy).
- **Session Store**: Database-backed sessions (secure, persistent).
- **Middleware**: `auth.ts` middleware ensures only authenticated users can access protected routes.

To protect a route, use the `isAuthenticated` middleware:
```typescript
import { isAuthenticated } from '../middleware/auth';
router.get('/protected', isAuthenticated, (req, res) => { ... });
```

## 🌐 API Routes (`src/routes/`)

The API is versioned and organized by resource:

### `/api/auth`
- `POST /login`: Generate a session.
- `POST /logout`: Destroy session.
- `GET /me`: Get current user info.

### `/api/courses`
- `GET /`: List all courses (with optional filtering).
- `GET /:id`: detailed view of a specific course.
- `POST /`: Add a new course manually.

### `/api/dashboard`
- `GET /stats`: Aggregated metrics (total courses, last scrape time).
- `GET /recent-activity`: Recent scrape logs.

### `/api/scraper`
- `POST /start`: Trigger a scrape job.
- `GET /status`: Check the status of the current job.

### `/api/excel`
- `GET /export`: Download data as an Excel file (`.xlsx`).

## 🛠 Adding New Endpoints

1.  **Create a route file**: In `src/routes/newFeature.ts`.
2.  **Define routes**:
    ```typescript
    import { Router } from 'express';
    const router = Router();
    router.get('/', (req, res) => res.send('New Feature'));
    export default router;
    ```
3.  **Register the router**: In `src/routes/index.ts`.
    ```typescript
    import newFeatureRoutes from './newFeature';
    router.use('/new-feature', newFeatureRoutes);
    ```

## 📝 Error Handling

- Global error handling middleware is recommended but currently implemented per route.
- Standard HTTP status codes are used:
    - `200`: Success
    - `400`: Bad Request (Validation Error)
    - `401`: Unauthorized
    - `404`: Not Found
    - `500`: Internal Server Error

## 📦 Dependencies

Key backend dependencies:
- **`express`**: Web framework.
- **`prisma`**: ORM.
- **`cheerio`**: HTML parsing (used by scraper).
- **`puppeteer`**: Headless browser automation (used by scraper).
- **`exceljs`**: Excel file generation.
