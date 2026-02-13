const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { inlineSource } = require('inline-source');

const genHeader = (size, buf, len) => {
    let idx = 0;
    let data = 'unsigned char index_html[] = {\n  ';

    for (let i = 0; i < buf.length; i++) {
        const value = buf[i];
        idx++;
        const current = value < 0 ? value + 256 : value;
        data += '0x' + current.toString(16).padStart(2, '0');

        if (idx === len) {
            data += '\n';
        } else {
            data += idx % 12 === 0 ? ',\n  ' : ', ';
        }
    }

    data += '};\n';
    data += 'unsigned int index_html_len = ' + len + ';\n';
    data += 'unsigned int index_html_size = ' + size + ';\n';
    return data;
};

const run = async () => {
    try {
        const htmlPath = path.resolve(__dirname, 'dist/index.html');
        console.log('Inlining ' + htmlPath + '...');
        
        const html = await inlineSource(htmlPath, {
            compress: false,
            rootpath: path.resolve(__dirname, 'dist')
        });

        console.log('Compressing with gzip...');
        const fileSize = Buffer.byteLength(html);
        const compressed = zlib.gzipSync(html);
        
        console.log('Generating header...');
        const header = genHeader(fileSize, compressed, compressed.length);
        
        const outputPath = path.resolve(__dirname, '../src/html.h');
        fs.writeFileSync(outputPath, header);
        console.log('Successfully wrote to ' + outputPath);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
};

run();