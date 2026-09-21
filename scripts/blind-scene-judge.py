"""Independent lightweight vision-model review. No repo text is sent to the model.
This is an advisory visual check, not a replacement for browser tests or a strong
human art-direction review. Exact image assignment is revealed only after judging.
"""
import hashlib
import json
import os
from pathlib import Path
import secrets
import torch
from PIL import Image
from huggingface_hub import HfApi
from transformers import AutoProcessor, AutoModelForVision2Seq

root = Path(os.environ.get('DREAM_EVIDENCE', '.dream-evidence'))
pair = [root / 'baseline/baseline.png', root / 'candidate/midnight.png']
if not all(p.is_file() for p in pair):
    raise SystemExit('Both actual renders are required; refusing to invent a comparison.')
if secrets.randbits(1):
    pair.reverse()
images = [Image.open(p).convert('RGB') for p in pair]
for image in images:
    image.thumbnail((512, 512))
model_id = 'HuggingFaceTB/SmolVLM-500M-Instruct'
revision = HfApi().model_info(model_id).sha
processor = AutoProcessor.from_pretrained(model_id, revision=revision, trust_remote_code=False, size={'longest_edge': 512})
torch.set_num_threads(min(4, os.cpu_count() or 1))
model = AutoModelForVision2Seq.from_pretrained(model_id, revision=revision, trust_remote_code=False, torch_dtype=torch.float32, _attn_implementation='eager').eval()
rubric = ('Compare only these two rendered scenes, called A and B. Which has clearer foreground-to-background depth, a readable water path, and controlled glowing lights rather than large white washed-out areas? Describe visible evidence and choose A, B, or uncertain. Do not assume either image is newer or better. Do not judge website controls. Keep your answer under 100 words.')
records = []
for order in [(0, 1), (1, 0)]:
    messages = [{'role': 'user', 'content': [
        {'type': 'text', 'text': 'A:'}, {'type': 'image'},
        {'type': 'text', 'text': 'B:'}, {'type': 'image'},
        {'type': 'text', 'text': rubric},
    ]}]
    prompt = processor.apply_chat_template(messages, add_generation_prompt=True)
    inputs = processor(text=prompt, images=[images[i] for i in order], return_tensors='pt')
    with torch.inference_mode():
        generated = model.generate(**inputs, max_new_tokens=150, do_sample=False)
    answer = processor.batch_decode(generated[:, inputs['input_ids'].shape[1]:], skip_special_tokens=True)[0]
    records.append({'presentation': ['A', 'B'], 'reversed': order == (1, 0), 'answer': answer})
    print(json.dumps(records[-1]), flush=True)
report = {'model': model_id, 'revision': revision, 'rubric': rubric, 'advisory_only': True, 'reviews': records}
(root / 'blind-review.json').write_text(json.dumps(report, indent=2))
# Reveal only after both independent inferences have completed.
reveal = {'A': str(pair[0]), 'B': str(pair[1]), 'image_sha256': [hashlib.sha256(p.read_bytes()).hexdigest() for p in pair]}
(root / 'blind-reveal.json').write_text(json.dumps(reveal, indent=2))
print('REVEAL ' + json.dumps(reveal), flush=True)
