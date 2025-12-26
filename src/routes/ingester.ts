import express from 'express';

import { ingestData } from '../controllers/ingester';

const router = express.Router();

router.post('/', ingestData);

export default router;
