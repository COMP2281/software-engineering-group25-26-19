# Database & Prisma Documentation

This guide covers the installation of PostgreSQL, setting up the Prisma ORM, running migrations, and examples of how to use the Prisma Client in your project.

## 1. PostgreSQL Installation

Before running the project, you need a running PostgreSQL instance.

### macOS
**Using Homebrew**
1.  Open your terminal.
2.  Install PostgreSQL:
    ```bash
    brew install postgresql@14
    ```
3.  Start the service:
    ```bash
    brew services start postgresql@14
    ```
4.  Create a default `postgres` user (if needed):
    ```bash
    createuser -s postgres
    ```

### Windows
**Option A: Official Installer**
1.  Download the installer from [postgresql.org](https://www.postgresql.org/download/windows/).
2.  Run the installer.
3.  **Important:** Remember the password you set for the `postgres` superuser during installation.
4.  Stack Builder may ask to install add-ons; you can typically skip this for basic development.
5.  Open "pgAdmin 4" (installed automatically) to manage your database, or use the SQL Shell (psql).

**Option B: Docker**
If you have Docker Desktop installed:
```bash
docker run --name my-postgres -e POSTGRES_PASSWORD=mysecretpassword -p 5432:5432 -d postgres
```

### Linux (Ubuntu/Debian)
1.  Update package list:
    ```bash
    sudo apt update
    ```
2.  Install PostgreSQL:
    ```bash
    sudo apt install postgresql postgresql-contrib
    ```
3.  Start the service:
    ```bash
    sudo systemctl start postgresql
    ```
4.  By default, Postgres uses `ident` authentication. You may need to change the password for the `postgres` user:
    ```bash
    sudo -i -u postgres
    psql
    \password postgres
    (enter new password)
    \q
    exit
    ```

---

## 2. Project Setup (Backend)

The backend is located in the `backend/` folder.

### 1. Install Dependencies
Navigate to the backend directory and install the packages:
```bash
cd backend
npm install
```
This will install `prisma` and `@prisma/client`.

### 2. Configure Environment Variables
Create a `.env` file in the `backend/` directory (if it doesn't exist):
```bash
# backend/.env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/YOUR_DATABASE_NAME?schema=public"
```
*   **USER**: Usually `postgres` or your system username.
*   **PASSWORD**: The password you set during installation.
*   **YOUR_DATABASE_NAME**: The name of the database you want to use (e.g., `se_coursework`). You don't need to create this manually; Prisma can often create it, or you can create it via `createdb se_coursework` (mac/linux) or pgAdmin.

### 3. Create Client
```bash
cd backend
npx prisma generate
```
(This has to be called in the same directory as the `prisma` folder, so inside of /backend/)

---

## 3. Managing the Database

### Run Migrations
To verify your schema works and create the tables in your database, run:
```bash
cd backend
npx prisma migrate dev --name init
```
*   This command applies the SQL in `prisma/migrations` to your database.
*   It also regenerates the Prisma Client types.
*   If you make changes to `schema.prisma`, run this command again with a new name (e.g., `npx prisma migrate dev --name add_user_model`).

### Inspect Data (Prisma Studio)
Prisma provides a GUI to view and edit your data:
```bash
cd backend
npx prisma studio
```
This will open a web page at `http://localhost:5555`.

---

## 4. Usage Examples

You can use the Prisma Client instance exported from `src/db.ts` to interact with your database.

### Importing the Client
```typescript
// In any service or controller file
import prisma from './db'; // Adjust path to src/db.ts
```

### Create a University and Course
```typescript
async function createDurhamData() {
  // 1. Create a University
  const durham = await prisma.university.create({
    data: {
      name: "Durham University",
      ukprn: "10007143",
      website: "https://www.dur.ac.uk",
      // You can create related courses in the same query
      courses: {
        create: {
          ucasCourseId: "K001",
          title: "Computer Science",
          summary: "A great course covering software engineering.",
          courseUrl: "https://www.dur.ac.uk/courses/cs",
          // Create Course Options
          options: {
             create: {
               year: 2026,
               studyMode: "Full-time",
               homeFee: 9250,
             }
          }
        }
      }
    }
  });

  console.log("Created University:", durham);
}
```

### Fetch Data
```typescript
async function getCourses() {
  // Get all courses with their university and options
  const courses = await prisma.course.findMany({
    include: {
      university: true,
      options: true
    }
  });
  
  return courses;
}
```

### Filtering Data
```typescript
async function findComputerScienceCourses() {
  const csCourses = await prisma.course.findMany({
    where: {
      title: {
        contains: "Computer Science",
        mode: "insensitive" // Case-insensitive search
      }
    },
    include: {
      university: {
        select: {
          name: true // Only fetch the university name
        }
      }
    }
  });
  
  console.log(csCourses);
}
```

### Updating Data
```typescript
async function updateCourseUrl(courseId: string, newUrl: string) {
  const updated = await prisma.course.update({
    where: { id: courseId },
    data: {
      courseUrl: newUrl
    }
  });
  
  return updated;
}
```
