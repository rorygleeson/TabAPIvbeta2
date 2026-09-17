'use strict';

const fs = require('fs');
const path = require('path');

function loadContract(name) {
  const packaged = path.join(__dirname, 'contracts', name);
  const repository = path.join(__dirname, '..', '..', 'contracts', name);
  const target = fs.existsSync(packaged) ? packaged : repository;
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}

function loadContractText(name) {
  const packaged = path.join(__dirname, 'contracts', name);
  const repository = path.join(__dirname, '..', '..', 'contracts', name);
  const target = fs.existsSync(packaged) ? packaged : repository;
  return fs.readFileSync(target, 'utf8');
}

module.exports = { loadContract, loadContractText };
