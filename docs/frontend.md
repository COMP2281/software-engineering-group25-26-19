# Frontend Documentation (Layer 1)

This document provides a comprehensive overview of the frontend application architecture, technologies used, and guidelines for extending the codebase.

## 📦 Tech Stack

- **Framework**: React 18
- **Build Tool**: Vite
- **Language**: TypeScript
- **State Management**: React Hooks (primarily `useState`, `useEffect`)
- **API Communication**: Axios (via custom API wrappers)
- **Styling**: CSS Modules / Standard CSS

## 📂 Directory Structure

The frontend source code is located in `frontend/src/` and follows a feature-based structure:

```
src/
├── api/             # API definition layers (services)
├── components/      # Reusable UI components
├── layouts/         # Page layout wrappers (e.g., ProtectedLayout)
├── pages/           # Main route components (views)
├── routes/          # Application routing configuration
├── App.tsx          # Main entry point
└── main.tsx         # React DOM rendering
```

### Key Modules

#### 1. API Integration (`src/api/`)
The API layer abstracts backend calls. Each module corresponds to a backend route group.
- **`Courses.api.ts`**: Fetches course lists and details.
- **`Dashboard.api.ts`**: Retrieves scraper statistics.
- **`Scraper.api.ts`**: Triggers and monitors scraping tasks.
- **`Login.api.ts`**: Handles authentication.
- **`Excel.api.ts`**: Handles Excel export functionality.

#### 2. Pages (`src/pages/`)
- **`Dashboard.tsx`**: The main view showing scrape status, recent activity, and quick stats.
- **`Courses.tsx`**: A searchable list of all scraped courses.
- **`CourseDetails.tsx`**: Detailed view of a single course, including fee breakdowns.
- **`LoginPage.tsx`**: User authentication screen.

#### 3. Components (`src/components/`)
- **`Sidebar.tsx`**: Navigation menu for the dashboard layout.
- **`ProtectedLayout.tsx`**: Wrapping component that ensures users are logged in before accessing protected routes.

## 🔄 Data Flow & State

This application primarily uses local component state. Data is fetched on mount using `useEffect` hooks calling the API layer.

**Example Pattern:**
```typescript
const [courses, setCourses] = useState<Course[]>([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
  CoursesApi.getAll()
    .then(data => setCourses(data))
    .finally(() => setLoading(false));
}, []);
```

## 🛠 Maintenance & Extensibility

### Adding a New Page

1.  Create the component in `src/pages/NewPage.tsx`.
2.  Add the route in `src/routes/AppRouter.tsx`.
3.  Add a navigation link in `src/components/Sidebar.tsx`.

### Extending the API

If a new backend endpoint is added:
1.  Open the relevant file in `src/api/` (or create a new one).
2.  Define the response type interface in `*.types.ts`.
3.  Add a static method to the API class using `axios`.

### Styling Guidelines

- Prefer CSS Modules (`*.module.css`) for component-scoped styles to avoid global namespace pollution.
- Use `App.css` only for global resets and typography.

## 🐛 Troubleshooting

- **CORS Errors**: Ensure the backend is running on `http://localhost:5001` and the frontend proxy (in `vite.config.ts`) is correctly configured.
- **Types**: Always define interfaces for API responses to leverage TypeScript's type safety.
