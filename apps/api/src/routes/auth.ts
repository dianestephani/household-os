import { Router } from 'express';
import {
  isAllowedEmail,
  signSession,
  verifyGoogleIdToken,
} from '../services/session.js';

const router: Router = Router();

router.post('/google', async (req, res) => {
  const body = (req.body ?? {}) as { credential?: string };
  if (!body.credential) {
    res.status(400).json({ error: 'credential is required' });
    return;
  }

  try {
    const verified = await verifyGoogleIdToken(body.credential);

    if (!verified.email_verified) {
      res.status(401).json({ error: 'email_not_verified' });
      return;
    }
    if (!isAllowedEmail(verified.email)) {
      res.status(403).json({ error: 'email_not_allowed' });
      return;
    }

    const token = signSession(verified.email);
    res.json({
      token,
      email: verified.email,
      name: verified.name,
      picture: verified.picture,
    });
  } catch (err) {
    console.error('[auth/google] verification failed', err);
    res.status(401).json({ error: 'invalid_credential' });
  }
});

export default router;
