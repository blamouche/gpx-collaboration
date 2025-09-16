import express from 'express';
import health from './health';

const app = express();
const PORT = process.env.PORT || 3001;

app.use('/health', health);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
