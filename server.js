const http = require("http");
const express = require('express');
const dotnev = require('dotenv');
const axios = require("axios");
const fs = require("fs").promises; // Import the fs module

const app = express();
require('dotenv').config(); 

const hostname = "localhost";
const port = process.env.PORT || 3001;
const API_KEY = process.env.DIFY_API_KEY;
const url = process.env.DIFY_API_ENDPOINT;

app.use(express.json());

const read_transcript = async (filePath) => {
    try {
        const data = await fs.readFile(filePath, "utf8"); // Read the file
        return data; // Return the file content
    } catch (err) {
        throw err; // Throw the error to be handled in the calling function
    }
};


const fetchApiData = async () => {
    const transcript = await read_transcript("assets/transcript_1.txt"); // Read the transcript
    const parsedTranscript = JSON.parse(transcript);
    const QUERY = parsedTranscript.result.segments.map(segment => segment.text).join(" "); // Join with a space

    try {
        const response = await axios.post(
            url,
            {
                inputs: { query: QUERY },
                response_mode: "streaming",
                user: "user-123",
            },
            {
                headers: {
                    Authorization: `Bearer ${API_KEY}`,
                    "Content-Type": "application/json",
                },
                responseType: "stream", // Set response type to stream
            }
        );

        let fullAnswer = ""; // Initialize a variable to hold the complete answer

        // Listen for data events on the response stream
        response.data.on("data", (chunk) => {
            // Each chunk is a string that needs to be processed
            const messages = chunk.toString().split("\n"); // Split the chunk by new lines
            messages.forEach((message) => {
                if (message.startsWith("data: ")) {
                    const jsonData = message.slice(6); // Remove 'data: ' prefix
                    if (jsonData) {
                        try {
                            const parsedData = JSON.parse(jsonData); // Parse the JSON
                            if (parsedData.answer) {
                                fullAnswer += parsedData.answer; // Concatenate the answer
                            }
                        } catch (parseError) {
                            console.error("Error parsing JSON:", parseError);
                        }
                    }
                }
            });
        });

        // Return a promise that resolves when the stream ends
        return new Promise((resolve, reject) => {
            response.data.on("end", () => {
                resolve(fullAnswer); // Resolve with the complete answer
            });
            response.data.on("error", (error) => {
                reject(error); // Reject on error
            });
        });

    } catch (error) {
        console.error("Error making API call:", error);
        throw error; // Throw the error to be handled in the server
    }
};

app.post('/api/proxy', async (req, res) => {
    try {
        const data = await fetchApiData(); // Call the fetchApiData function
        res.end(JSON.stringify(data)); 
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: "Error making API call" }));
    }
});

app.listen(port, () => {
    console.log(`Proxy server running at ${port}`);
});