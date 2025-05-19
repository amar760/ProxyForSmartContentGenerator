const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const OpenAI = require('openai');
const { Writable, PassThrough } = require('stream');
const cors = require('cors');

require('dotenv').config(); 

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
app.use(express.json());
app.use(cors());
const PORT = 3002;

const API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({API_KEY});

const CHUNKS_DIR = path.join(__dirname, 'chunks');
if (!fs.existsSync(CHUNKS_DIR)) {
    fs.mkdirSync(CHUNKS_DIR);
}

// Add CORS headers
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Or '*' to allow all origins during development
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE'); // Add methods you use
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Add headers you use
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204); // No Content
    }
    next();
});

async function getChunks() {
    try {
      const response = await axios.get('http://localhost:3001/getChunks', {
        responseType: 'arraybuffer' // Use this if you expect binary data
      });
      // response.data is a Buffer containing the binary data
      return response.data;
    } catch (error) {
      console.error('Error fetching chunks:', error.response?.data || error.message);
      throw error;
    }
}


async function getAudioFromChunks(chunkBuffer) {
    return new Promise((resolve, reject) => {
        const tsStream = new PassThrough();
        tsStream.end(chunkBuffer);
        
        ffmpeg(tsStream)
        .audioCodec('pcm_s16le')
        .format('wav')
        .on('end', () => {
            console.log('Audio extraction complete.');
            resolve();
        })
        .on('error', (err) => {
            console.error('Error during audio extraction:', err);
            reject(err);
        })
        .save('output.wav')
    }); 
}

const fetchTranscriptTillTimestamp = async () => {
    try{
        // Read existing transcript.txt if it exists
        let previousTranscript = '';
        const transcriptPath = path.join(__dirname, 'transcript.txt');
        if (fs.existsSync(transcriptPath)) {
            previousTranscript = fs.readFileSync(transcriptPath, 'utf8');
        }

        const chunkBuffer = await getChunks();
        if (!chunkBuffer){
            return previousTranscript;
        }

        await getAudioFromChunks(chunkBuffer);

        console.log("Calling whisper...");
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream('output.wav'),
            model: "whisper-1",
            language: "en", // this is optional but helps the model
        });

        // Append new transcript
        const combinedTranscript = previousTranscript + (previousTranscript ? '\n' : '') + transcription.text;
        fs.writeFileSync(transcriptPath, combinedTranscript, 'utf8');

        console.log(transcription.text);
        return combinedTranscript;
    } catch(e){
        console.error("Error fetching transcript from audio", e.message);
    }
}

const pollForChunks = async () => {
    while (true){
        await fetchTranscriptTillTimestamp();
        await new Promise(resolve => setTimeout(resolve, 10000));
    }
}


app.get('/getTranscript', async (req, res) => {
    try{
        const transcript = await fetchTranscriptTillTimestamp();
        res.status(200).json({transcript: transcript});
    } catch(e){
        res.status(500).json({error: e.message});
    }
});


app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    pollForChunks();
});
  