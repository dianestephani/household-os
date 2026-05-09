import { afterAll, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';

const TEST_URL =
  process.env.MONGO_TEST_URL ?? 'mongodb://localhost:27017/household_os_test';

beforeAll(async () => {
  await mongoose.connect(TEST_URL);
});

beforeEach(async () => {
  const collections = mongoose.connection.collections;
  await Promise.all(
    Object.values(collections).map((c) => c.deleteMany({})),
  );
});

afterAll(async () => {
  await mongoose.disconnect();
});
