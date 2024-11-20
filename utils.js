import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

const API_URL = 'https://session-am5x.onrender.com';

export async function upload(folderPath) {
	if (!fs.existsSync(folderPath)) throw new Error('Folder does not exist');
	const formData = new FormData();
	const files = fs.readdirSync(folderPath);
	if (files.length === 0) throw new Error('Folder is empty');
	files.forEach(file => formData.append('files', fs.createReadStream(path.join(folderPath, file)), file));
	const {
		data: { accessKey },
	} = await axios.post(`${API_URL}/upload`, formData, {
		headers: { ...formData.getHeaders() },
		maxContentLength: Infinity,
		maxBodyLength: Infinity,
		onUploadProgress: e => console.log(`Upload progress: ${Math.round((e.loaded * 100) / e.total)}%`),
	});
	return accessKey;
}

export function cleanPhoneNumber(phoneNumber) {
	return phoneNumber.trim().replace(/[^\d]/g, '');
}
