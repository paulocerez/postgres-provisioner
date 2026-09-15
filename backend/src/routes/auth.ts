import { Router } from 'express';
import { loginHandler, loginRateLimiter, logoutHandler, meHandler } from '../auth.js';

export const authRouter: Router = Router();

authRouter.post('/login', loginRateLimiter, loginHandler);
authRouter.post('/logout', logoutHandler);
authRouter.get('/me', meHandler);
