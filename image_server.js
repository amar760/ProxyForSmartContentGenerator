const http = require("http");
const axios = require("axios");
const fs = require("fs"); // Import the fs module for file operations
const OpenAI = require("openai");
const dotenv = require("dotenv");
require('dotenv').config(); 

const hostname = "localhost";
const port = 3002; // Use a different port for the image server
const API_KEY = process.env.OPEN_API_KEY; // Replace with your OpenAI API key

const openai = new OpenAI({
    apiKey:
        process.env.OPENAI_API_KEY ||
        (() => {
            throw new Error(
                "The OPENAI_API_KEY environment variable is missing or empty."
            );
        })(),
});

// Function to generate an image with text
const generateImage = async (prompt) => {
    try {
        if (!fs.existsSync('image.png')){
            const result = await openai.images.generate({
                model: "gpt-image-1",
                prompt,
            });
            const image_base64 = result.data[0].b64_json;
            const image_bytes = Buffer.from(image_base64, "base64");
            fs.writeFileSync("image.png", image_bytes);
            return image_bytes;
        }
        return "";
    } catch (error) {
        console.error("OpenAI image generation error:", {
            status: error.response?.status,
            statusText: error.response?.statusText,
            headers: error.response?.headers,
            data: error.response?.data,
            message: error.message,
        });
        throw new Error("Failed to generate background image");
    }
};

// Create the server
const server = http.createServer(async (req, res) => {
    if (req.method === "POST") {
        var body = "Create an A4-sized infographic that visually represents the following content: ...";

        // Collect the incoming data
        req.on("data", (chunk) => {
            body += chunk.toString(); // Convert Buffer to string
        });

        req.on("end", async () => {
            try {
                const imageUrl = await generateImage(body); // Generate the image
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ imageUrl })); // Send back the image URL
            } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: "Error generating image" }));
            }
        });
    } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "Not Found" }));
    }
});

// Start the server
server.listen(port, hostname, () => {
    console.log(`Image server running at http://${hostname}:${port}/`);
});
