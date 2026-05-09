import mongoose from 'mongoose';

export async function connect(url: string) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(url);
  return mongoose.connection;
}

export async function disconnect() {
  await mongoose.disconnect();
}
