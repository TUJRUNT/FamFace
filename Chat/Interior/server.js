const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// File upload limits and allowed types
const multer = require('multer');
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = [
    'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp',
    'application/pdf', 'text/plain'
];

app.use(express.static(path.dirname(__filename)));

// Serve uploaded files from /uploads
const uploadsDir = path.join(path.dirname(__filename), 'uploads');
const fs = require('fs');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
app.use('/uploads', express.static(uploadsDir));

// Configure multer storage
const storage = multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
        const safeName = `${Date.now()}_${file.originalname}`.replace(/\s+/g, '_');
        cb(null, safeName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Invalid file type'));
    }
});

// Data structures for groups
const groups = {}; // { groupCode: { users: {}, messages: [], createdAt: timestamp } }
const userGroups = {}; // { socketId: groupCode }
const userLocations = {}; // { socketId: { userId, latitude, longitude, accuracy, timestamp } }
const activeCalls = {}; // { callId: { initiator, receiver, type, status } }

// HTTP endpoint for file uploads (supports progress on client via XHR)
app.post('/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const file = req.file;
        const fileUrl = `/uploads/${encodeURIComponent(file.filename)}`;
        const senderId = req.headers['x-sender-id'];
        const groupCode = userGroups[senderId];

        if (!groupCode || !groups[groupCode]) {
            return res.status(400).json({ error: 'User not in a valid group' });
        }

        const group = groups[groupCode];
        const sender = group.users[senderId];
        
        const fileMessage = {
            id: Date.now(),
            sender: (sender && sender.name) || req.body.sender || 'Unknown',
            senderId: senderId || null,
            text: '',
            file: {
                name: file.originalname,
                type: file.mimetype,
                size: file.size,
                url: fileUrl
            },
            timestamp: new Date().toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            })
        };

        group.messages.push(fileMessage);
        io.to(groupCode).emit('receive_message', fileMessage);

        return res.json({ ok: true, file: fileMessage.file });
    } catch (err) {
        console.error('Upload error', err);
        return res.status(500).json({ error: 'Upload failed' });
    }
});

let users = {};
let messages = [];
// Active uploads map: uploadId -> { stream, received, meta, tempPath }
const activeUploads = {};

// Limits
const MAX_FILE_SIZE_SOCKET = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES_SOCKET = [
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'application/pdf', 'text/plain'
];

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Handle user joining a group
    socket.on('join', (data) => {
        const username = data.username;
        const groupCode = data.groupCode ? data.groupCode.toUpperCase() : null;

        if (!username || !groupCode) {
            socket.emit('group_join_failed', { message: 'Invalid username or group code' });
            return;
        }

        // Check if group exists, if not create it
        if (!groups[groupCode]) {
            groups[groupCode] = {
                users: {},
                messages: [],
                createdAt: new Date(),
                code: groupCode
            };
            console.log(`New group created: ${groupCode}`);
        }

        const group = groups[groupCode];

        // Add user to group
        group.users[socket.id] = {
            id: socket.id,
            name: username,
            picture: data.picture || null,
            joinedAt: new Date()
        };

        userGroups[socket.id] = groupCode;

        // Join socket.io room for this group
        socket.join(groupCode);

        console.log(`${username} joined group ${groupCode}`);
        
        // Send all previous messages in this group to the new user
        socket.emit('load_messages', group.messages);
        
        // Broadcast that a user joined to everyone in the group
        io.to(groupCode).emit('user_joined', {
            username: username,
            usersCount: Object.keys(group.users).length,
            users: Object.values(group.users)
        });
    });

    // Handle incoming messages
    socket.on('send_message', (data) => {
        const groupCode = userGroups[socket.id];
        if (!groupCode || !groups[groupCode]) return;

        const group = groups[groupCode];
        const user = group.users[socket.id];
        if (!user) return;

        const messageObj = {
            id: Date.now(),
            sender: user.name,
            senderId: socket.id,
            text: data.text,
            timestamp: new Date().toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: true 
            }),
            clientMessageId: data.clientMessageId || null,
            edited: false
        };

        group.messages.push(messageObj);
        
        // Broadcast message only to users in this group
        io.to(groupCode).emit('receive_message', messageObj);
        
        console.log(`${user.name} (${groupCode}): ${data.text}`);
    });

    // Handle message editing
    socket.on('edit_message', (data) => {
        const groupCode = userGroups[socket.id];
        if (!groupCode || !groups[groupCode]) return;

        const group = groups[groupCode];
        const message = group.messages.find(msg => msg.id === data.messageId);
        
        if (message && message.senderId === socket.id) {
            message.text = data.newText;
            message.edited = true;
            io.to(groupCode).emit('message_edited', {
                messageId: data.messageId,
                newText: data.newText
            });
        }
    });

    // Handle video/voice call initiation
    socket.on('call_user', (data) => {
        const groupCode = userGroups[socket.id];
        if (!groupCode || !groups[groupCode]) return;

        const targetSocket = io.sockets.sockets.get(data.to);
        if (targetSocket) {
            targetSocket.emit('incoming_call', {
                from: socket.id,
                callerName: data.callerName,
                type: data.type
            });
        }
    });

    // Handle call acceptance
    socket.on('accept_call', (data) => {
        const targetSocket = io.sockets.sockets.get(data.to);
        if (targetSocket) {
            targetSocket.emit('call_accepted', { from: socket.id });
        }
    });

    // Handle call rejection
    socket.on('reject_call', (data) => {
        const targetSocket = io.sockets.sockets.get(data.to);
        if (targetSocket) {
            targetSocket.emit('call_rejected', { from: socket.id });
        }
    });

    // Handle location sharing
    socket.on('share_location', (data) => {
        const groupCode = userGroups[socket.id];
        if (!groupCode || !groups[groupCode]) return;

        const group = groups[groupCode];
        const user = group.users[socket.id];
        const targetSocket = io.sockets.sockets.get(data.targetUserId);
        
        if (targetSocket && user) {
            targetSocket.emit('receive_location', {
                fromName: user.name,
                latitude: data.latitude,
                longitude: data.longitude
            });
        }
    });

    // Handle file uploads sent via socket.io (binary)
    socket.on('send_file', async (fileMeta, fileBuffer) => {
        try {
            const groupCode = userGroups[socket.id];
            if (!groupCode || !groups[groupCode]) return;

            const group = groups[groupCode];
            const user = group.users[socket.id];
            if (!user) return;

            // fileBuffer may be an ArrayBuffer or Buffer
            const buf = Buffer.from(fileBuffer);
            const timestamp = Date.now();
            const safeName = `${timestamp}_${fileMeta.name}`.replace(/\s+/g, '_');
            const filePath = path.join(uploadsDir, safeName);

            // Save file to uploads directory
            await fs.promises.writeFile(filePath, buf);

            const fileUrl = `/uploads/${encodeURIComponent(safeName)}`;

            const fileMessage = {
                id: Date.now(),
                sender: user.name,
                senderId: socket.id,
                text: '',
                file: {
                    name: fileMeta.name,
                    type: fileMeta.type,
                    size: fileMeta.size,
                    url: fileUrl
                },
                timestamp: new Date().toLocaleTimeString('en-US', { 
                    hour: '2-digit', 
                    minute: '2-digit',
                    hour12: true 
                })
            };

            group.messages.push(fileMessage);
            io.to(groupCode).emit('receive_message', fileMessage);
            console.log(`File received from ${fileMessage.sender} (${groupCode}): ${fileMeta.name}`);
        } catch (err) {
            console.error('Error saving uploaded file', err);
            socket.emit('error', { message: 'File upload failed' });
        }
    });

    // Handle voice/video call initiation
    socket.on('initiate_call', (data) => {
        const groupCode = userGroups[socket.id];
        if (!groupCode || !groups[groupCode]) return;

        const group = groups[groupCode];
        const caller = group.users[socket.id];
        if (!caller) return;

        const callId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
        activeCalls[callId] = {
            initiator: socket.id,
            receiver: data.targetUserId || null,
            type: data.callType, // 'audio' or 'video'
            status: 'ringing',
            groupCode: groupCode
        };

        // Notify all members in the group about the incoming group call
        io.to(groupCode).emit('incoming_call', {
            callId: callId,
            from: socket.id,
            callerName: caller.name,
            callType: data.callType,
            isGroup: !data.targetUserId
        });

        console.log(`${caller.name} initiated ${data.callType} call in group ${groupCode}`);
    });

    // Handle call acceptance
    socket.on('accept_call', (data) => {
        const callId = data.callId;
        const call = activeCalls[callId];
        
        if (!call) return;

        call.status = 'active';

        // Notify both parties
        io.to(call.groupCode).emit('call_accepted', {
            callId: callId,
            initiator: call.initiator,
            receiver: call.receiver,
            callType: call.type
        });

        console.log(`Call ${callId} accepted`);
    });

    // Handle call rejection
    socket.on('reject_call', (data) => {
        const callId = data.callId;
        const call = activeCalls[callId];
        
        if (!call) return;

        // Notify both parties
        io.to(call.groupCode).emit('call_rejected', {
            callId: callId,
            from: socket.id
        });

        delete activeCalls[callId];
        console.log(`Call ${callId} rejected`);
    });

    // Handle call end
    socket.on('end_call', (data) => {
        const callId = data.callId;
        const call = activeCalls[callId];
        
        if (!call) return;

        io.to(call.groupCode).emit('call_ended', {
            callId: callId
        });

        delete activeCalls[callId];
        console.log(`Call ${callId} ended`);
    });

    // Handle WebRTC signaling (SDP and ICE candidates)
    socket.on('webrtc_offer', (data) => {
        const groupCode = userGroups[socket.id];
        if (!groupCode) return;

        io.to(groupCode).emit('webrtc_offer', {
            from: socket.id,
            offer: data.offer,
            callId: data.callId
        });
    });

    socket.on('webrtc_answer', (data) => {
        const groupCode = userGroups[socket.id];
        if (!groupCode) return;

        io.to(groupCode).emit('webrtc_answer', {
            from: socket.id,
            answer: data.answer,
            callId: data.callId
        });
    });

    socket.on('ice_candidate', (data) => {
        const groupCode = userGroups[socket.id];
        if (!groupCode) return;

        io.to(groupCode).emit('ice_candidate', {
            from: socket.id,
            candidate: data.candidate,
            callId: data.callId
        });
    });

    // Relay simple peer-style signaling between specific peers for mesh group calls
    socket.on('webrtc_signal', (data) => {
        // data: { to, from, signal, callId }
        try {
            const target = io.sockets.sockets.get(data.to);
            if (target) {
                target.emit('webrtc_signal', data);
            }
        } catch (err) {
            console.error('Error relaying webrtc_signal', err);
        }
    });

    // Handle profile updates from clients
    socket.on('update_profile', (data) => {
        try {
            const groupCode = userGroups[socket.id];
            if (!groupCode || !groups[groupCode]) return;

            const group = groups[groupCode];
            const user = group.users[socket.id];
            if (!user) return;

            if (data.name) user.name = data.name;
            if (data.picture !== undefined) user.picture = data.picture;

            // Broadcast updated user list to the group
            io.to(groupCode).emit('user_updated', {
                users: Object.values(group.users)
            });

            console.log(`User profile updated (${socket.id}) in ${groupCode}`);
        } catch (err) {
            console.error('Error updating profile', err);
        }
    });

    // Handle location sharing
    socket.on('share_location', (data) => {
        const groupCode = userGroups[socket.id];
        if (!groupCode || !groups[groupCode]) return;

        const group = groups[groupCode];
        const user = group.users[socket.id];
        if (!user) return;

        userLocations[socket.id] = {
            userId: socket.id,
            userName: user.name,
            latitude: data.latitude,
            longitude: data.longitude,
            accuracy: data.accuracy || 'Unknown',
            timestamp: new Date().toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            })
        };

        // Broadcast location to requester
        if (data.requesterSocket) {
            io.to(data.requesterSocket).emit('location_update', {
                userId: socket.id,
                userName: user.name,
                latitude: data.latitude,
                longitude: data.longitude,
                accuracy: data.accuracy || 'Unknown',
                timestamp: userLocations[socket.id].timestamp
            });
        } else {
            // Share with all users in the group
            io.to(groupCode).emit('location_update', {
                userId: socket.id,
                userName: user.name,
                latitude: data.latitude,
                longitude: data.longitude,
                accuracy: data.accuracy || 'Unknown',
                timestamp: userLocations[socket.id].timestamp
            });
        }

        console.log(`Location shared by ${user.name} (${groupCode}): ${data.latitude}, ${data.longitude}`);
    });

    // Handle location request (when user right-clicks to track)
    socket.on('request_location', (data) => {
        const targetUserId = data.targetUserId;
        
        // Find the socket id of the user being tracked
        const groupCode = userGroups[socket.id];
        if (!groupCode || !groups[groupCode]) return;

        const group = groups[groupCode];
        if (!group.users[targetUserId]) return;

        // Request location from the target user
        const targetUser = group.users[targetUserId];
        
        io.to(groupCode).emit('location_request', {
            from: socket.id,
            fromName: group.users[socket.id].name,
            targetUserId: targetUserId
        });

        console.log(`${group.users[socket.id].name} requested location from ${targetUser.name}`);
    });

    // Handle user disconnect
    socket.on('disconnect', () => {
        const groupCode = userGroups[socket.id];
        
        if (groupCode && groups[groupCode]) {
            const group = groups[groupCode];
            const user = group.users[socket.id];
            
            if (user) {
                console.log(`${user.name} disconnected from group ${groupCode}`);
                delete group.users[socket.id];
                
                // Notify other users in the group
                io.to(groupCode).emit('user_left', {
                    username: user.name,
                    usersCount: Object.keys(group.users).length,
                    users: Object.values(group.users)
                });

                // Delete group if empty
                if (Object.keys(group.users).length === 0) {
                    delete groups[groupCode];
                    console.log(`Group ${groupCode} deleted (empty)`);
                }
            }
        }

        // Clean up locations and active calls
        delete userLocations[socket.id];
        for (const callId in activeCalls) {
            const call = activeCalls[callId];
            if (call.initiator === socket.id || call.receiver === socket.id) {
                delete activeCalls[callId];
            }
        }

        delete userGroups[socket.id];
        delete users[socket.id];
    });

    // Chunked upload start
    socket.on('upload_start', (meta) => {
        const groupCode = userGroups[socket.id];
        if (!groupCode || !groups[groupCode]) {
            socket.emit('upload_error', { uploadId: meta.uploadId, message: 'Not in a group' });
            return;
        }

        // meta: { uploadId, name, type, size }
        if (meta.size > MAX_FILE_SIZE_SOCKET) {
            socket.emit('upload_error', { uploadId: meta.uploadId, message: 'File too large (max 10MB)' });
            return;
        }

        if (ALLOWED_TYPES_SOCKET.length && meta.type && !ALLOWED_TYPES_SOCKET.includes(meta.type)) {
            socket.emit('upload_error', { uploadId: meta.uploadId, message: 'File type not allowed' });
            return;
        }

        const tempName = `${meta.uploadId}.part`;
        const tempPath = path.join(uploadsDir, tempName);
        try {
            const stream = fs.createWriteStream(tempPath, { flags: 'w' });
            activeUploads[meta.uploadId] = { stream, received: 0, meta, tempPath, groupCode };
            socket.emit('upload_accepted', { uploadId: meta.uploadId });
        } catch (err) {
            socket.emit('upload_error', { uploadId: meta.uploadId, message: 'Server error starting upload' });
        }
    });

    // Receive upload chunk
    socket.on('upload_chunk', (uploadId, chunk) => {
        const up = activeUploads[uploadId];
        if (!up) {
            socket.emit('upload_error', { uploadId, message: 'Upload not found' });
            return;
        }

        try {
            const buf = Buffer.from(chunk);
            up.stream.write(buf);
            up.received += buf.length;

            const percent = Math.floor((up.received / up.meta.size) * 100);
            socket.emit('upload_progress', { uploadId, percent });

            // If finished
            if (up.received >= up.meta.size) {
                up.stream.end();

                const safeName = `${Date.now()}_${up.meta.name}`.replace(/\s+/g, '_');
                const finalPath = path.join(uploadsDir, safeName);
                fs.renameSync(up.tempPath, finalPath);

                const fileUrl = `/uploads/${encodeURIComponent(safeName)}`;

                const group = groups[up.groupCode];
                if (!group) {
                    delete activeUploads[uploadId];
                    return;
                }

                const user = group.users[socket.id];

                const fileMessage = {
                    id: Date.now(),
                    sender: (user && user.name) || 'Unknown',
                    senderId: socket.id,
                    text: '',
                    file: {
                        name: up.meta.name,
                        type: up.meta.type,
                        size: up.meta.size,
                        url: fileUrl
                    },
                    timestamp: new Date().toLocaleTimeString('en-US', { 
                        hour: '2-digit', 
                        minute: '2-digit',
                        hour12: true 
                    })
                };

                group.messages.push(fileMessage);
                io.to(up.groupCode).emit('receive_message', fileMessage);
                delete activeUploads[uploadId];
                console.log(`File upload completed (${up.groupCode}): ${fileMessage.file.name}`);
            }
        } catch (err) {
            console.error('Error writing chunk', err);
            socket.emit('upload_error', { uploadId, message: 'Server error during upload' });
            if (up && up.stream) up.stream.destroy();
            try { if (up && up.tempPath && fs.existsSync(up.tempPath)) fs.unlinkSync(up.tempPath); } catch (e) {}
            delete activeUploads[uploadId];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Chat server running on http://localhost:${PORT}`);
});

