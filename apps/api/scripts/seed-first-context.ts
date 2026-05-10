import 'dotenv/config';
import { connect, disconnect } from '../src/db/connection.js';
import { addContext } from '../src/services/context.js';

const url = process.env.MONGO_URL ?? 'mongodb://localhost:27017/household_os';
await connect(url);

const entry = await addContext({
  text: "Watching 7 guest dogs today. Constantly cleaning up surprise dog messes — zero downtime. Too tired and it would all go to chaos if I left, so no workout, no errands, didn't leave the house.",
  energy: 'low',
  mood: 'down',
  dogsit_count: 7,
  blocked_activities: ['workout', 'leave_house', 'errands'],
  tags: ['dogsit-stress', 'high-load'],
  related_persona: 'both',
  source: 'api',
});

console.log('seeded context entry', entry._id);
await disconnect();
process.exit(0);
