import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { requireAuth, AuthRequest } from './src/middleware/auth.ts';
import {
  getOrCreateUser,
  getUserProfile,
  getAllEvents,
  createNewEvent,
  updateExistingEvent,
  deleteEventById,
  getAttendingEventIds,
  toggleAttendee,
  getAllArtists
} from './src/db/queries.ts';

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());

// API Routes FIRST

// 1. Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Pulse database backend is active.' });
});

// 2. Fetch all music events
app.get('/api/events', async (req, res) => {
  try {
    const list = await getAllEvents();
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Internal database error' });
  }
});

// 3. Sync user auth state, email, and role (artist / non-artist)
app.post('/api/users/sync', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { email, role } = req.body;
    if (!req.user || !req.user.uid) {
      return res.status(401).json({ error: 'Unauthorized: No active user token found' });
    }
    const uid = req.user.uid;
    const userEmail = email || req.user.email || 'guest@example.com';
    const userRole = role || 'non-artist';

    const dbUser = await getOrCreateUser(uid, userEmail, userRole);
    res.json({ success: true, user: dbUser });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to sync user state' });
  }
});

// 4. Get active user details
app.get('/api/users/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const profile = await getUserProfile(req.user.uid);
    res.json(profile || { uid: req.user.uid, email: req.user.email, role: 'non-artist' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Create new music event (authenticated artist or authorized party)
app.post('/api/events', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const eventParams = req.body;
    const creatorUid = req.user.uid;
    // Inject the creator's email into the music event for UI rendering
    eventParams.createdByEmail = req.user.email;

    const event = await createNewEvent(eventParams, creatorUid);
    res.status(201).json(event);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Update existing music event
app.put('/api/events/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const eventParams = req.body;
    const creatorUid = req.user.uid;

    const updated = await updateExistingEvent(eventParams, creatorUid);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Delete music event
app.delete('/api/events/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const eventId = req.params.id;
    const creatorUid = req.user.uid;

    await deleteEventById(eventId, creatorUid);
    res.json({ success: true, message: 'Event deleted successfully.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 8. Get current RSVPs / attending list
app.get('/api/users/me/attending', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const list = await getAttendingEventIds(req.user.uid);
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 9. Attend / RSVP toggler
app.post('/api/events/:id/attend', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const eventId = req.params.id;
    const result = await toggleAttendee(req.user.uid, eventId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 10. Fetch all registered artists (restricted to authenticated/registered users)
app.get('/api/artists', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user || !req.user.uid) {
      return res.status(401).json({ error: 'Unauthorized: Complete registration/sign in to unlock the artists circuit' });
    }
    const list = await getAllArtists();
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Internal database error' });
  }
});

// Serve Frontend SPA
async function setupVite() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('Dev mode: Integrated Vite dev server as middleware.');
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log('Production mode: Serving pre-built static assets.');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Pulse app running locally on port ${PORT}`);
  });
}

setupVite();
