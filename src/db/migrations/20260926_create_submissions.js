import knex from 'knex';

export async function up(knexInstance) {
  return knexInstance.schema.createTable('submissions', (table) => {
    table.increments('id');
    table.string('student_id');
    table.string('file_path');
    table.string('file_type');
    table.text('content_text'); // For text-based homework
    table.string('status').defaultTo('pending'); // pending, processing, graded, failed
    table.text('grading_result');
    table.timestamp('created_at').defaultTo(knexInstance.fn.now());
  });
}

export async function down(knexInstance) {
  return knexInstance.schema.dropTable('submissions');
}
