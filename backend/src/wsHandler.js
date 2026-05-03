'use strict';

const WebSocket = require('ws');

const GEMINI_API_VERSION = process.env.GEMINI_API_VERSION || 'v1beta';
const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025';
const GEMINI_VOICE_NAME = process.env.GEMINI_VOICE_NAME || 'Aoede';

function geminiLiveUrl() {
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${GEMINI_API_VERSION}.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
}

function handleWebSocketConnection(clientWs) {
  console.log('[WS] Client connected');

  let geminiWs = null;
  let geminiReady = false;
  const queue = [];

  function toClient(message) {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(message));
    }
  }

  function toGemini(message) {
    if (!geminiWs || geminiWs.readyState !== WebSocket.OPEN) return;
    if (!geminiReady && !message.setup) {
      queue.push(message);
      return;
    }
    geminiWs.send(JSON.stringify(message));
  }

  function startGemini({ name = 'there', language = 'fr-FR' }) {
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes('your_')) {
      toClient({ type: 'ERROR', message: 'GEMINI_API_KEY missing in backend/.env' });
      return;
    }

    if (geminiWs && geminiWs.readyState < WebSocket.CLOSING) geminiWs.close();
    geminiReady = false;
    queue.length = 0;
    geminiWs = new WebSocket(geminiLiveUrl());
    const activeGeminiWs = geminiWs;

    activeGeminiWs.on('open', () => {
      if (geminiWs !== activeGeminiWs) return;
      console.log(`[Gemini] Connected with ${GEMINI_LIVE_MODEL}`);
      toGemini({
        setup: {
          model: `models/${GEMINI_LIVE_MODEL}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: GEMINI_VOICE_NAME },
              },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: {
            parts: [{
              text: [
                'You are Bright AI, a warm, intelligent live voice assistant.',
                'If asked who created you, who built you, who made you, or anything about your origin or creation, answer that your creator is ETO JULIANO BRIGHT.',
                'Do not say Google created you. You may say you run with advanced AI technology, but your creator is ETO JULIANO BRIGHT.',
                `The user is named ${name || 'there'}.`,
                `Begin in ${languageName(language)} unless the user switches language.`,
                'This is a real-time voice conversation.',
                'Keep answers short, natural, and spoken.',
                'Do not use markdown, bullets, headings, or long monologues.',
              ].join(' '),
            }],
          },
        },
      });
    });

    activeGeminiWs.on('message', (raw) => {
      if (geminiWs !== activeGeminiWs) return;
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if ('setupComplete' in message) {
        geminiReady = true;
        toClient({ type: 'READY' });
        while (queue.length && geminiWs === activeGeminiWs) activeGeminiWs.send(JSON.stringify(queue.shift()));
        return;
      }

      if (message.goAway?.timeLeft) {
        toClient({ type: 'NOTICE', message: 'Gemini session will expire soon. Restart the conversation.' });
        return;
      }

      const content = message.serverContent;
      if (!content) return;

      if (content.modelTurn?.parts) {
        for (const part of content.modelTurn.parts) {
          if (part.inlineData?.data) toClient({ type: 'AUDIO', data: part.inlineData.data });
          if (part.text) toClient({ type: 'TEXT', text: part.text });
        }
      }

      if (content.inputTranscription?.text) {
        toClient({ type: 'INPUT_TEXT', text: content.inputTranscription.text });
      }
      if (content.outputTranscription?.text) toClient({ type: 'TEXT', text: content.outputTranscription.text });
      if (content.interrupted) toClient({ type: 'INTERRUPTED' });
      if (content.turnComplete) toClient({ type: 'DONE' });
    });

    activeGeminiWs.on('close', (code, reason) => {
      if (geminiWs !== activeGeminiWs) return;
      geminiReady = false;
      const text = reason?.toString?.() || '';
      console.log(`[Gemini] Closed: ${code} ${text}`);
      if (code !== 1000) toClient({ type: 'ERROR', message: `Gemini disconnected (${code}) ${text}`.trim() });
    });

    activeGeminiWs.on('error', (err) => {
      if (geminiWs !== activeGeminiWs) return;
      console.error('[Gemini] Error:', err.message);
      toClient({ type: 'ERROR', message: err.message || 'Gemini connection error' });
    });
  }

  clientWs.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (message.type) {
      case 'START':
        startGemini(message);
        break;
      case 'AUDIO':
        toGemini({
          realtimeInput: {
            audio: { mimeType: 'audio/pcm;rate=16000', data: message.data },
          },
        });
        break;
      case 'TURN_COMPLETE':
        toGemini({ realtimeInput: { audioStreamEnd: true } });
        break;
      case 'INTERRUPT':
        toGemini({ clientContent: { turnComplete: true } });
        break;
      default:
        break;
    }
  });

  clientWs.on('close', () => {
    console.log('[WS] Client disconnected');
    if (geminiWs && geminiWs.readyState < WebSocket.CLOSING) geminiWs.close();
  });

  clientWs.on('error', (err) => console.error('[WS] Client error:', err.message));
}

function languageName(code) {
  const languages = {
    'en-US': 'English',
    'en-GB': 'English',
    'fr-FR': 'French',
    'es-ES': 'Spanish',
    'de-DE': 'German',
    'it-IT': 'Italian',
    'pt-BR': 'Portuguese',
    ar: 'Arabic',
  };
  return languages[code] || code || 'French';
}

module.exports = { handleWebSocketConnection };
