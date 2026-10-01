import { Test } from '@nestjs/testing';
import * as nodemailer from 'nodemailer';
import { EmailTransportService } from './email-transport.service';

describe('Nodemailer runtime compatibility', () => {
  it('constructs the real SMTP transport with the application settings', async () => {
    const module = await Test.createTestingModule({ providers: [EmailTransportService] }).compile();
    const service = module.get(EmailTransportService);
    const transporter = service.buildTransporter({
      host: 'smtp.example.test',
      port: 587,
      username: 'reader',
      password: 'test-password',
      auth: true,
      ssl: false,
      startTls: true,
      tlsRejectUnauthorized: true,
    });

    try {
      expect(transporter.options).toMatchObject({
        host: 'smtp.example.test',
        port: 587,
        requireTLS: true,
        auth: { user: 'reader', pass: 'test-password' },
      });
      expect(transporter.sendMail).toBeTypeOf('function');
      expect(transporter.verify).toBeTypeOf('function');
    } finally {
      transporter.close();
      await module.close();
    }
  });

  it('composes a book attachment using the real mail library without network access', async () => {
    const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true });

    try {
      const result = await transporter.sendMail({
        from: { name: 'BookOrbit', address: 'sender@example.test' },
        to: 'reader@example.test',
        subject: 'Your book',
        text: 'Attached is your book.',
        attachments: [{ filename: 'book.epub', content: Buffer.from('test-book'), contentType: 'application/epub+zip' }],
      });

      expect(result.envelope).toEqual({ from: 'sender@example.test', to: ['reader@example.test'] });
      expect(Buffer.isBuffer(result.message)).toBe(true);
      if (!Buffer.isBuffer(result.message)) throw new Error('Expected a buffered MIME message');
      const message = result.message.toString('utf8');
      expect(message).toContain('Subject: Your book');
      expect(message).toContain('filename=book.epub');
      expect(message).toContain('application/epub+zip');
    } finally {
      transporter.close();
    }
  });
});
