part of '../main.dart';

class AdminBroadcastScreen extends StatefulWidget {
  const AdminBroadcastScreen({super.key});

  @override
  State<AdminBroadcastScreen> createState() => _AdminBroadcastScreenState();
}

class _AdminBroadcastScreenState extends State<AdminBroadcastScreen> {
  final _titleController =
      TextEditingController(text: 'Promo Upgrade Platinum TapGo');
  final _messageController = TextEditingController(
    text:
        'Halo member TapGo, upgrade paket Anda minggu ini dan nikmati benefit PPOB serta reward referral lebih besar.',
  );

  @override
  void dispose() {
    _titleController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return _DemoScaffold(
      title: 'Broadcast',
      subtitle: 'Preview pengumuman dan WhatsApp broadcast',
      child: Column(
        children: [
          _InputField(
            controller: _titleController,
            icon: Icons.campaign_rounded,
            label: 'Judul broadcast',
            hint: 'Judul pesan',
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _messageController,
            maxLines: 5,
            decoration: InputDecoration(
              prefixIcon: const Icon(Icons.message_rounded, color: _brandBlue),
              labelText: 'Isi pesan',
              filled: true,
              fillColor: Colors.white,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(18),
                borderSide: BorderSide.none,
              ),
            ),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 16),
          _BroadcastPreview(
            title: _titleController.text,
            message: _messageController.text,
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: () {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('Broadcast tersimpan sebagai preview.'),
                  ),
                );
              },
              icon: const Icon(Icons.send_rounded),
              label: const Text('Preview Kirim Broadcast'),
            ),
          ),
        ],
      ),
    );
  }
}

class _BroadcastPreview extends StatelessWidget {
  const _BroadcastPreview({required this.title, required this.message});

  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFE8FFF3),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Preview WhatsApp / Push Notification',
            style: TextStyle(
              color: Color(0xFF00A86B),
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            title.isEmpty ? 'Judul broadcast' : title,
            style: const TextStyle(
              color: Color(0xFF0A2A43),
              fontSize: 17,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            message.isEmpty
                ? 'Isi pesan broadcast akan tampil di sini.'
                : message,
            style: const TextStyle(color: Color(0xFF263241), height: 1.45),
          ),
        ],
      ),
    );
  }
}
