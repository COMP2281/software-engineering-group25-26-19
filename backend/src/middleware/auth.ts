import { Request, Response, NextFunction } from "express";

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (req.session && req.session.user) {
    next();
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
};
